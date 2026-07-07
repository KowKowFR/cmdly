import { NextRequest, NextResponse } from "next/server";
import { logger } from "@/lib/logger";

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

  // TODO(task-10): implement real SSH, Zabbix, Wazuh connection tests using their respective clients.
  return NextResponse.json({
    ok: false,
    message: "Test disponible une fois la configuration enregistrée",
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

  // TODO(task-10): add more provider tests
  return NextResponse.json({ ok: false, message: `Fournisseur LLM non reconnu: ${provider}` });
}
