import { randomUUID } from "crypto";
import { getSession } from "@/lib/auth/config";
import { getConfig } from "@/lib/config";
import { db } from "@/lib/db";
import { messages } from "@/lib/db/schema";
import { takePendingConfirmation } from "@/lib/chat/runStore";
import { executeTool } from "@/lib/tools/executor";
import { logger } from "@/lib/logger";
import type { ExecutionContext } from "@/types/tools";

// Register all tools so their side-effects (register calls) are in place
import "@/lib/tools";

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const { conversationId, toolCallId, confirmed, typed } = body as Record<
    string,
    unknown
  >;

  if (confirmed !== true) {
    return Response.json({ error: "confirmed doit être true" }, { status: 400 });
  }
  if (typeof conversationId !== "string" || typeof toolCallId !== "string") {
    return Response.json(
      { error: "conversationId et toolCallId requis" },
      { status: 400 }
    );
  }

  const pending = takePendingConfirmation(conversationId, toolCallId);
  if (!pending) {
    return Response.json(
      { error: "Aucune confirmation en attente pour ce toolCallId" },
      { status: 404 }
    );
  }
  if (pending.userId !== session.user.id) {
    return Response.json({ error: "Accès refusé" }, { status: 403 });
  }

  // Verify typed confirmation if the tool requires it.
  // Guard is truthy-check so an empty-string requireTyping is treated as absent.
  if (pending.requireTyping) {
    if (typeof typed !== "string" || typed !== pending.requireTyping) {
      return Response.json(
        { error: "La confirmation saisie ne correspond pas" },
        { status: 400 }
      );
    }
  }

  let config;
  try {
    config = await getConfig();
  } catch (err) {
    logger.error("POST /api/tools: getConfig failed", { error: String(err) });
    return Response.json({ error: "Erreur de configuration" }, { status: 500 });
  }

  const userRole = session.user.role as ExecutionContext["userRole"];
  const ctx: ExecutionContext = {
    userId: session.user.id,
    userRole,
    ipAddress: req.headers.get("x-forwarded-for") ?? "unknown",
    config,
  };

  const outcome = await executeTool(pending.name, pending.params, ctx, { confirmed: true });

  const humanReadable =
    outcome.status === "success"
      ? outcome.result.humanReadable
      : outcome.status === "error" || outcome.status === "denied"
      ? outcome.reason
      : "Résultat inconnu";

  // Persist tool result message
  try {
    await db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      role: "tool",
      content: humanReadable,
      toolCallId,
    });
  } catch (err) {
    // Non-fatal — log and continue so the client still gets the result
    logger.error("POST /api/tools: failed to persist tool message", {
      error: String(err),
    });
  }

  return Response.json({
    status: outcome.status,
    humanReadable,
    result: outcome.status === "success" ? outcome.result.data : undefined,
  });
}
