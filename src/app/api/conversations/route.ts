import { eq, desc } from "drizzle-orm";
import { getSession } from "@/lib/auth/config";
import { db } from "@/lib/db";
import { conversations } from "@/lib/db/schema";
import { logger } from "@/lib/logger";

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: "Non autorisé" }, { status: 401 });
  }

  try {
    const rows = await db
      .select({
        id: conversations.id,
        title: conversations.title,
        updatedAt: conversations.updatedAt,
      })
      .from(conversations)
      .where(eq(conversations.userId, session.user.id))
      .orderBy(desc(conversations.updatedAt))
      .limit(50);

    return Response.json({ conversations: rows });
  } catch (err) {
    logger.error("GET /api/conversations: error", { error: String(err) });
    return Response.json({ error: "Erreur interne" }, { status: 500 });
  }
}
