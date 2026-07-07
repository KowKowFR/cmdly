/**
 * ZabbixClient — JSON-RPC 2.0 client for the Zabbix API.
 *
 * Uses native fetch (Zabbix typically runs on trusted TLS or HTTP internally).
 * Accepts an optional `fetchOverride` in the constructor for unit-testing.
 */

import type { InfrastructureConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { FetchFn } from "@/lib/proxmox";

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface ZabbixMetricPoint {
  clock: number;
  value: string;
}

// ─── Internal JSON-RPC types ──────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
  id: number;
}

interface JsonRpcResponse<T> {
  jsonrpc?: string;
  result?: T;
  error?: { code: number; message: string; data?: string };
  id?: number;
}

interface ZabbixHistoryItem {
  clock?: string | number;
  value?: string;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class ZabbixClient {
  private readonly apiUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly user: string;
  private readonly password: string;
  /** Cached auth token from user.login */
  private authToken: string | null = null;

  constructor(
    cfg: Pick<InfrastructureConfig, "zabbixUrl" | "zabbixUser" | "zabbixPassword">,
    fetchOverride?: FetchFn,
  ) {
    this.apiUrl = `${cfg.zabbixUrl.replace(/\/$/, "")}/api_jsonrpc.php`;
    this.user = cfg.zabbixUser;
    this.password = cfg.zabbixPassword;

    if (fetchOverride) {
      this.fetchFn = fetchOverride;
    } else {
      // Zabbix uses native fetch by default. Pass an undici-backed fetchOverride
      // to the constructor for self-signed-TLS Zabbix deployments.
      this.fetchFn = (url: string, init: object) =>
        fetch(url, init as RequestInit) as Promise<{
          ok: boolean;
          status: number;
          json(): Promise<unknown>;
        }>;
    }
  }

  // ─── JSON-RPC helper ────────────────────────────────────────────────────────

  private async rpc<T>(
    method: string,
    params: Record<string, unknown>,
    requireAuth = true,
  ): Promise<T> {
    if (requireAuth && !this.authToken) {
      await this.login();
    }

    const body: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      id: 1,
    };

    const res = await this.fetchFn(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(requireAuth && this.authToken
          ? { Authorization: `Bearer ${this.authToken}` }
          : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      throw new Error(`Zabbix API HTTP error: ${res.status}`);
    }

    const json = (await res.json()) as JsonRpcResponse<T>;

    if (json.error) {
      throw new Error(
        `Zabbix API error [${json.error.code}]: ${json.error.message} — ${json.error.data ?? ""}`,
      );
    }

    if (json.result === undefined) {
      throw new Error("Zabbix API returned no result");
    }

    return json.result;
  }

  // ─── Authentication ──────────────────────────────────────────────────────────

  private async login(): Promise<void> {
    // Zabbix 5.x: user.login with user/password params.
    // Zabbix 6.x+: same but token is used via Authorization header.
    const token = await this.rpc<string>(
      "user.login",
      { username: this.user, password: this.password },
      false, // no auth header for login itself
    );
    this.authToken = token;
  }

  // ─── Connection test ────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      // apiinfo.version requires no authentication
      const version = await this.rpc<string>("apiinfo.version", {}, false);
      logger.info("ZabbixClient.testConnection OK", { version });
      return { ok: true, message: `Zabbix API ${version} accessible` };
    } catch (err) {
      logger.warn("ZabbixClient.testConnection failed", { err: String(err) });
      return { ok: false, message: String(err) };
    }
  }

  // ─── Get metrics ─────────────────────────────────────────────────────────────

  async getMetrics(params: {
    hostName: string;
    metricName: string;
    period: string;
  }): Promise<ZabbixMetricPoint[]> {
    const { hostName, metricName, period } = params;

    // 1. Resolve hostid from hostname
    const hosts = await this.rpc<Array<{ hostid?: string }>>(
      "host.get",
      { filter: { host: [hostName] }, output: ["hostid"] },
    );

    if (hosts.length === 0) {
      throw new Error(`Zabbix: host "${hostName}" not found`);
    }

    const hostid = hosts[0]?.hostid ?? "";
    if (!hostid) throw new Error(`Zabbix: hostid missing for "${hostName}"`);

    // 2. Resolve itemid from metricName (search key_ and name)
    const items = await this.rpc<Array<{ itemid?: string }>>(
      "item.get",
      {
        hostids: [hostid],
        search: { name: metricName },
        output: ["itemid", "name"],
        limit: 1,
      },
    );

    if (items.length === 0) {
      throw new Error(
        `Zabbix: metric "${metricName}" not found on host "${hostName}"`,
      );
    }

    const itemid = items[0]?.itemid ?? "";
    if (!itemid) throw new Error(`Zabbix: itemid missing for metric "${metricName}"`);

    // 3. Parse period string to time range (e.g. "1h", "24h", "7d")
    const now = Math.floor(Date.now() / 1000);
    const periodSec = parsePeriodToSeconds(period);
    const timeFrom = now - periodSec;

    // 4. Fetch history (value type 0 = numeric float; try 0 first)
    const history = await this.rpc<ZabbixHistoryItem[]>(
      "history.get",
      {
        itemids: [itemid],
        time_from: timeFrom,
        time_till: now,
        output: "extend",
        sortfield: "clock",
        sortorder: "ASC",
        limit: 500,
      },
    );

    return history.map((h) => ({
      clock: Number(h.clock ?? 0),
      value: String(h.value ?? ""),
    }));
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePeriodToSeconds(period: string): number {
  const match = /^(\d+)([smhd])$/.exec(period.trim().toLowerCase());
  if (!match) {
    // Default to 1 hour if unparseable
    return 3600;
  }
  const n = Number(match[1]);
  const unit = match[2];
  switch (unit) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    default:  return 3600;
  }
}
