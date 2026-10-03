import type { DB } from "@/db/client";
import { auditLog } from "@/db/schema";

/** Records who changed what. Every mutating server action calls this. */
export async function audit(
  db: DB,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  summary?: string,
) {
  await db.insert(auditLog).values({ actorId, action, entityType, entityId, summary });
}
