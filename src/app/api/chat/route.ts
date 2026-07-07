import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { conversations, messages } from "@/lib/db/schema";
import { getConfig } from "@/lib/config";
import { createRun } from "@/lib/chat/runStore";
import { logger } from "@/lib/logger";

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

  const { conversationId: existingConvId, message } = body as Record<string, unknown>;

  if (typeof message !== "string" || message.trim() === "") {
    return Response.json({ error: "Message requis" }, { status: 400 });
  }

  const userId = session.user.id;
  const trimmedMessage = message.trim();
  let conversationId: string;

  try {
    if (typeof existingConvId === "string" && existingConvId.length > 0) {
      // Verify conversation exists and belongs to this user
      const conv = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, existingConvId))
        .limit(1);
      const existing = conv[0];
      if (!existing || existing.userId !== userId) {
        return Response.json({ error: "Conversation introuvable" }, { status: 404 });
      }
      conversationId = existingConvId;
    } else {
      // Create new conversation
      const config = await getConfig();
      const provider = config.defaultLlmProvider || "openai";
      const model =
        provider === "openai"
          ? config.openaiModel || "gpt-4o"
          : provider === "anthropic"
          ? config.anthropicModel || "claude-opus-4-8"
          : config.ollamaModel || "llama3";

      conversationId = randomUUID();
      await db.insert(conversations).values({
        id: conversationId,
        userId,
        title: trimmedMessage.slice(0, 60),
        model,
        provider,
      });
    }

    // Persist user message
    await db.insert(messages).values({
      id: randomUUID(),
      conversationId,
      role: "user",
      content: trimmedMessage,
    });

    // Register pending stream run
    const streamId = createRun({ userId, conversationId, message: trimmedMessage });

    return Response.json({ streamId, conversationId });
  } catch (err) {
    logger.error("POST /api/chat: error", { error: String(err) });
    return Response.json({ error: "Erreur interne du serveur" }, { status: 500 });
  }
}
