/**
 * WazuhClient — queries the Wazuh Indexer (OpenSearch-compatible API).
 *
 * Uses undici with a custom Agent to accept self-signed TLS certificates.
 * Accepts an optional `fetchOverride` in the constructor for unit-testing.
 */

import { Agent, fetch as undiciFetch } from "undici";
import type { RequestInit } from "undici";
import type { InfrastructureConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { FetchFn } from "@/lib/proxmox";

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface WazuhAlert {
  id: string;
  level: number;
  description: string;
  agentName: string;
  timestamp: string;
}

// ─── Raw API shapes (internal) ────────────────────────────────────────────────

interface RawHit {
  _id?: string;
  _source?: {
    rule?: { level?: number; description?: string };
    agent?: { name?: string };
    "@timestamp"?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
}

interface SearchParams {
  query: string;
  severity?: string;
  limit?: number;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class WazuhClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetchFn: FetchFn;

  constructor(
    cfg: Pick<InfrastructureConfig, "wazuhUrl" | "wazuhUser" | "wazuhPassword">,
    fetchOverride?: FetchFn,
  ) {
    this.baseUrl = cfg.wazuhUrl.replace(/\/$/, "");
    // Wazuh Indexer uses HTTP Basic auth
    const encoded = Buffer.from(`${cfg.wazuhUser}:${cfg.wazuhPassword}`).toString("base64");
    this.authHeader = `Basic ${encoded}`;

    if (fetchOverride) {
      this.fetchFn = fetchOverride;
    } else {
      const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
      this.fetchFn = (url: string, init: RequestInit) =>
        undiciFetch(url, {
          ...init,
          dispatcher,
        }) as Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
    }
  }

  private get defaultHeaders(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      "Content-Type": "application/json",
    };
  }

  // ─── Connection test ────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/`, {
        method: "GET",
        headers: this.defaultHeaders,
        signal: AbortSignal.timeout(8_000),
      });

      if (res.ok) {
        logger.info("WazuhClient.testConnection OK");
        return { ok: true, message: "Wazuh Indexer accessible" };
      }
      return { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      logger.warn("WazuhClient.testConnection failed", { err: String(err) });
      return { ok: false, message: String(err) };
    }
  }

  // ─── Search alerts ───────────────────────────────────────────────────────────
  // Queries the wazuh-alerts-* index using the OpenSearch Query DSL.

  async searchAlerts({ query, severity, limit = 20 }: SearchParams): Promise<WazuhAlert[]> {
    // Build a bool query: must match the text query, optional minimum severity
    const must: unknown[] = [
      {
        multi_match: {
          query,
          fields: ["rule.description", "agent.name"],
        },
      },
    ];

    if (severity) {
      const minLevel = Number(severity);
      if (!isNaN(minLevel)) {
        must.push({ range: { "rule.level": { gte: minLevel } } });
      }
    }

    const body = JSON.stringify({
      query: { bool: { must } },
      size: Math.min(limit, 100),
      sort: [{ "@timestamp": { order: "desc" } }],
    });

    const url = `${this.baseUrl}/wazuh-alerts-*/_search`;
    const res = await this.fetchFn(url, {
      method: "POST",
      headers: this.defaultHeaders,
      body,
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Wazuh searchAlerts failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      hits?: { hits?: RawHit[] };
    };

    const hits = json?.hits?.hits ?? [];
    return hits.map((hit) => ({
      id: hit._id ?? "",
      level: Number(hit._source?.rule?.level ?? 0),
      description: String(hit._source?.rule?.description ?? ""),
      agentName: String(hit._source?.agent?.name ?? ""),
      timestamp: String(hit._source?.["@timestamp"] ?? hit._source?.timestamp ?? ""),
    }));
  }
}
