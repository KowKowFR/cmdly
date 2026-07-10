import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { ZabbixClient } from "@/lib/zabbix";
import { WazuhClient } from "@/lib/wazuh";
import { testBastionConnection } from "@/lib/ssh";

type TestTarget = "proxmox" | "ssh" | "llm" | "zabbix" | "wazuh";

interface TestBody {
  target: TestTarget;
  data: Record<string, unknown>;
}

export async function POST(request: NextRequest) {
  let body: TestBody;
  try {
    body = await request.json() as TestBody;
  } catch {
    return NextResponse.json({ ok: false, message: "Corps JSON invalide" }, { status: 400 });
  }

  const { target, data } = body;

  if (target === "proxmox") {
    return testProxmox(data);
  }

  if (target === "llm") {
    return testLlm(data);
  }

  if (target === "ssh") {
    return testSsh(data);
  }

  if (target === "zabbix") {
    return testZabbix(data);
  }

  if (target === "wazuh") {
    return testWazuh(data);
  }

  return NextResponse.json({
    ok: false,
    message: `Cible de test inconnue: ${target}`,
  });
}

// ─── Proxmox connection test ──────────────────────────────────────────────────

async function testProxmox(data: Record<string, unknown>) {
  const host = String(data.proxmoxHost ?? "");
  const port = Number(data.proxmoxPort ?? 8006);
  const user = String(data.proxmoxUser ?? "");
  const tokenId = String(data.proxmoxTokenId ?? "");
  const secret = String(data.proxmoxTokenSecret ?? "");

  if (!host || !user || !tokenId || !secret) {
    return NextResponse.json({ ok: false, message: "Champs Proxmox manquants" });
  }

  try {
    // Use undici with a custom Agent to allow self-signed TLS on Proxmox hosts
    const { Agent, fetch: undiciFetch } = await import("undici");
    const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    const url = `https://${host}:${port}/api2/json/version`;
    const token = `PVEAPIToken=${user}!${tokenId}=${secret}`;

    const response = await undiciFetch(url, {
      method: "GET",
      headers: { Authorization: token },
      dispatcher,
      signal: AbortSignal.timeout(8000),
    });

    if (response.ok) {
      const json = await response.json() as { data?: { version?: string } };
      const version = json?.data?.version ?? "?";
      logger.info("Proxmox test OK", { host, version });
      return NextResponse.json({ ok: true, message: `Proxmox ${version} accessible` });
    }

    return NextResponse.json({ ok: false, message: `Proxmox a répondu HTTP ${response.status}` });
  } catch (err) {
    logger.warn("Proxmox test failed", { err: String(err) });
    return NextResponse.json({ ok: false, message: `Connexion échouée: ${String(err).slice(0, 120)}` });
  }
}

// ─── LLM connection test ──────────────────────────────────────────────────────

async function testLlm(data: Record<string, unknown>) {
  const provider = String(data.defaultLlmProvider ?? "");

  if (provider === "openai") {
    const apiKey = String(data.openaiApiKey ?? "");
    if (!apiKey) {
      return NextResponse.json({ ok: false, message: "Clé API OpenAI manquante" });
    }
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        return NextResponse.json({ ok: true, message: "OpenAI accessible" });
      }
      return NextResponse.json({ ok: false, message: `OpenAI a répondu HTTP ${response.status}` });
    } catch (err) {
      return NextResponse.json({ ok: false, message: `OpenAI inaccessible: ${String(err).slice(0, 120)}` });
    }
  }

  if (provider === "anthropic") {
    const apiKey = String(data.anthropicApiKey ?? "");
    if (!apiKey) {
      return NextResponse.json({ ok: false, message: "Clé API Anthropic manquante" });
    }
    try {
      const response = await fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        signal: AbortSignal.timeout(8000),
      });
      if (response.ok) {
        return NextResponse.json({ ok: true, message: "Anthropic accessible" });
      }
      return NextResponse.json({ ok: false, message: `Anthropic a répondu HTTP ${response.status}` });
    } catch (err) {
      return NextResponse.json({ ok: false, message: `Anthropic inaccessible: ${String(err).slice(0, 120)}` });
    }
  }

  if (provider === "ollama") {
    const baseUrl = String(data.ollamaBaseUrl ?? "http://localhost:11434");
    try {
      const response = await fetch(`${baseUrl}/api/version`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        return NextResponse.json({ ok: true, message: "Ollama accessible" });
      }
      return NextResponse.json({ ok: false, message: `Ollama a répondu HTTP ${response.status}` });
    } catch (err) {
      return NextResponse.json({ ok: false, message: `Ollama inaccessible: ${String(err).slice(0, 120)}` });
    }
  }

  return NextResponse.json({ ok: false, message: `Fournisseur LLM non reconnu: ${provider}` });
}

// ─── SSH bastion connection test ──────────────────────────────────────────────

async function testSsh(data: Record<string, unknown>) {
  const sshMode = data.sshMode === "local" ? "local" : "bastion";

  // Local mode needs no bastion fields — it just runs a command on this host.
  if (sshMode === "local") {
    const result = await testBastionConnection({
      sshMode: "local",
      bastionHost: "",
      bastionPort: 22,
      bastionUser: "",
      sshKeyPath: "",
    });
    return NextResponse.json(result);
  }

  const bastionHost = String(data.bastionHost ?? "");
  const bastionPort = Number(data.bastionPort ?? 22);
  const bastionUser = String(data.bastionUser ?? "");
  const sshKeyPath = String(data.sshKeyPath ?? "");

  if (!bastionHost || !bastionUser || !sshKeyPath) {
    return NextResponse.json({ ok: false, message: "Champs SSH manquants (host, user, keyPath)" });
  }

  try {
    // Build a minimal config for the SSH test — typed precisely to what testBastionConnection needs
    const cfg = {
      sshMode: "bastion" as const,
      bastionHost,
      bastionPort,
      bastionUser,
      sshKeyPath,
    };

    const result = await testBastionConnection(cfg);
    return NextResponse.json(result);
  } catch (err) {
    logger.warn("SSH test failed", { err: String(err) });
    return NextResponse.json({ ok: false, message: `SSH inaccessible: ${String(err).slice(0, 120)}` });
  }
}

// ─── Zabbix connection test ───────────────────────────────────────────────────

async function testZabbix(data: Record<string, unknown>) {
  const zabbixUrl = String(data.zabbixUrl ?? "");
  const zabbixUser = String(data.zabbixUser ?? "");
  const zabbixPassword = String(data.zabbixPassword ?? "");

  if (!zabbixUrl || !zabbixUser) {
    return NextResponse.json({ ok: false, message: "Champs Zabbix manquants (url, user)" });
  }

  try {
    // Build a minimal config — typed precisely to what ZabbixClient constructor needs
    const cfg = {
      zabbixUrl,
      zabbixUser,
      zabbixPassword,
    };

    const client = new ZabbixClient(cfg);
    const result = await client.testConnection();
    return NextResponse.json(result);
  } catch (err) {
    logger.warn("Zabbix test failed", { err: String(err) });
    return NextResponse.json({ ok: false, message: `Zabbix inaccessible: ${String(err).slice(0, 120)}` });
  }
}

// ─── Wazuh connection test ────────────────────────────────────────────────────

async function testWazuh(data: Record<string, unknown>) {
  const wazuhUrl = String(data.wazuhUrl ?? "");
  const wazuhUser = String(data.wazuhUser ?? "");
  const wazuhPassword = String(data.wazuhPassword ?? "");

  if (!wazuhUrl || !wazuhUser) {
    return NextResponse.json({ ok: false, message: "Champs Wazuh manquants (url, user)" });
  }

  try {
    // Build a minimal config — typed precisely to what WazuhClient constructor needs
    const cfg = {
      wazuhUrl,
      wazuhUser,
      wazuhPassword,
    };

    const client = new WazuhClient(cfg);
    const result = await client.testConnection();
    return NextResponse.json(result);
  } catch (err) {
    logger.warn("Wazuh test failed", { err: String(err) });
    return NextResponse.json({ ok: false, message: `Wazuh inaccessible: ${String(err).slice(0, 120)}` });
  }
}
