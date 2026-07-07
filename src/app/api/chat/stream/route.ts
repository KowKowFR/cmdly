import { getSession } from "@/lib/auth/config";
import { getConfig } from "@/lib/config";
import { getProvider } from "@/lib/llm";
import { takeRun } from "@/lib/chat/runStore";
import { runConversation } from "@/lib/chat/orchestrator";
import { sseHeaders, encodeSSE } from "@/lib/llm/streaming";
import { logger } from "@/lib/logger";
import type { ExecutionContext } from "@/types/tools";

// Register all tools so their side-effects (register calls) are in place
import "@/lib/tools";

// Force dynamic rendering — this is a streaming SSE route
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  const url = new URL(req.url);
  const streamId = url.searchParams.get("streamId");
  if (!streamId) {
    return Response.json({ error: "streamId manquant" }, { status: 400 });
  }

  const run = takeRun(streamId);
  if (!run) {
    return Response.json({ error: "streamId invalide ou expiré" }, { status: 404 });
  }
  if (run.userId !== session.user.id) {
    return Response.json({ error: "Accès refusé" }, { status: 403 });
  }

  let config;
  try {
    config = await getConfig();
  } catch (err) {
    logger.error("GET /api/chat/stream: getConfig failed", { error: String(err) });
    return Response.json({ error: "Erreur de configuration" }, { status: 500 });
  }

  const providerName = (config.defaultLlmProvider || "openai") as
    | "openai"
    | "anthropic"
    | "ollama";

  const model =
    providerName === "openai"
      ? config.openaiModel || "gpt-4o"
      : providerName === "anthropic"
      ? config.anthropicModel || "claude-3-5-sonnet-20241022"
      : config.ollamaModel || "llama3";

  const encoder = new TextEncoder();

  // Instantiate provider — if not configured, stream an error event
  let provider;
  try {
    provider = getProvider(providerName, config);
  } catch (err) {
    logger.error("GET /api/chat/stream: getProvider failed", { error: String(err) });
    const errStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(encodeSSE("error", { message: "Fournisseur LLM non configuré" }))
        );
        controller.close();
      },
    });
    return new Response(errStream, { headers: sseHeaders() });
  }

  const userRole = session.user.role as ExecutionContext["userRole"];
  const ctx: ExecutionContext = {
    userId: session.user.id,
    userRole,
    ipAddress: req.headers.get("x-forwarded-for") ?? "unknown",
    config,
  };

  const gen = runConversation(ctx, run.conversationId, provider, model);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const { event, data } of gen) {
          controller.enqueue(encoder.encode(encodeSSE(event, data)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(encodeSSE("error", { message })));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: sseHeaders() });
}
