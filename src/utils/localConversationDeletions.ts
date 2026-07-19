/**
 * Tracks conversations deleted from THIS device so socket echoes
 * (`groupDeleted` / `conversationDeleted` fan-out includes the initiator)
 * don't double-navigate or show "deleted by admin" alerts to the deleter.
 */
const locallyDeletedAt = new Map<string, number>();
const TTL_MS = 15_000;

export function markConversationLocallyDeleted(conversationId: unknown): void {
  const id = conversationId != null ? String(conversationId) : '';
  if (!id) return;
  const now = Date.now();
  for (const [key, ts] of locallyDeletedAt) {
    if (now - ts > TTL_MS) locallyDeletedAt.delete(key);
  }
  locallyDeletedAt.set(id, now);
}

export function wasConversationLocallyDeleted(conversationId: unknown): boolean {
  const id = conversationId != null ? String(conversationId) : '';
  if (!id) return false;
  const ts = locallyDeletedAt.get(id);
  if (ts == null) return false;
  if (Date.now() - ts > TTL_MS) {
    locallyDeletedAt.delete(id);
    return false;
  }
  return true;
}
