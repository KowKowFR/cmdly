/**
 * ProxmoxClient — wraps the Proxmox VE REST API.
 *
 * Uses undici with a custom Agent to accept self-signed TLS certificates.
 * Accepts an optional `fetchOverride` in the constructor for unit-testing
 * without a live Proxmox host.
 */

import { Agent, fetch as undiciFetch } from "undici";
import type { RequestInit } from "undici";
import type { InfrastructureConfig } from "@/lib/config";
import { logger } from "@/lib/logger";

// ─── Minimal fetch interface ──────────────────────────────────────────────────
// Defined narrowly so tests can pass a simple fake without undici types leaking.

export type FetchFn = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

// ─── Response shapes ──────────────────────────────────────────────────────────

export interface ProxmoxVm {
  vmid: number;
  name: string;
  status: string;
  maxmem: number;
  cpus: number;
  uptime: number;
  ip?: string;
  vlan?: string;
}

export interface ProxmoxVmStatus {
  status: string;
  uptime: number;
  cpu: number;
  mem: number;
  maxmem: number;
  disk: number;
}

// ─── Raw API shapes (internal) ────────────────────────────────────────────────

interface RawQemuItem {
  vmid?: number;
  name?: string;
  status?: string;
  maxmem?: number;
  cpus?: number;
  uptime?: number;
  [key: string]: unknown;
}

interface RawVmStatus {
  status?: string;
  uptime?: number;
  cpu?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  [key: string]: unknown;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class ProxmoxClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly node: string;
  private readonly fetchFn: FetchFn;

  constructor(cfg: InfrastructureConfig, fetchOverride?: FetchFn) {
    const port = cfg.proxmoxPort ?? 8006;
    this.baseUrl = `https://${cfg.proxmoxHost}:${port}`;
    // PVE API token auth header format
    this.authHeader = `PVEAPIToken=${cfg.proxmoxUser}!${cfg.proxmoxTokenId}=${cfg.proxmoxTokenSecret}`;
    this.node = cfg.proxmoxNode;

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
    return { Authorization: this.authHeader };
  }

  // ─── Connection test ────────────────────────────────────────────────────────

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api2/json/version`, {
        method: "GET",
        headers: this.defaultHeaders,
        signal: AbortSignal.timeout(8_000),
      });

      if (!res.ok) {
        return { ok: false, message: `HTTP ${res.status}` };
      }

      const json = (await res.json()) as { data?: { version?: string } };
      const version = json?.data?.version ?? "?";
      logger.info("ProxmoxClient.testConnection OK", { version });
      return { ok: true, message: `Proxmox ${version} accessible` };
    } catch (err) {
      logger.warn("ProxmoxClient.testConnection failed", { err: String(err) });
      return { ok: false, message: String(err) };
    }
  }

  // ─── List VMs ───────────────────────────────────────────────────────────────

  async listVms(): Promise<ProxmoxVm[]> {
    const url = `${this.baseUrl}/api2/json/nodes/${this.node}/qemu`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: this.defaultHeaders,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      throw new Error(`Proxmox listVms failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: RawQemuItem[] };
    const items = json?.data ?? [];

    return items.map((item) => ({
      vmid: Number(item.vmid ?? 0),
      name: String(item.name ?? ""),
      status: String(item.status ?? "unknown"),
      maxmem: Number(item.maxmem ?? 0),
      cpus: Number(item.cpus ?? 0),
      uptime: Number(item.uptime ?? 0),
      // IP and VLAN are not included in the qemu list endpoint;
      // they require per-VM network config calls (deferred to future).
    }));
  }

  // ─── VM status ──────────────────────────────────────────────────────────────

  async getVmStatus(vmid: number): Promise<ProxmoxVmStatus> {
    const url = `${this.baseUrl}/api2/json/nodes/${this.node}/qemu/${vmid}/status/current`;
    const res = await this.fetchFn(url, {
      method: "GET",
      headers: this.defaultHeaders,
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(`Proxmox getVmStatus(${vmid}) failed: HTTP ${res.status}`);
    }

    const json = (await res.json()) as { data?: RawVmStatus };
    const d = json?.data ?? {};

    return {
      status: String(d.status ?? "unknown"),
      uptime: Number(d.uptime ?? 0),
      cpu: Number(d.cpu ?? 0),
      mem: Number(d.mem ?? 0),
      maxmem: Number(d.maxmem ?? 0),
      disk: Number(d.disk ?? 0),
    };
  }
}
