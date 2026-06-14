export const LIVE_CHAT_SEND_COOLDOWN_MS = 3000;
export const LIVE_CHAT_BATCH_FLUSH_MS = 300;
export const LIVE_CHAT_MAX_MESSAGES = 100;

export type LiveChatIncoming = { sender: string; text: string };

export function canSendLiveChat(lastSentAt: number, now = Date.now()): boolean {
  if (!lastSentAt) return true;
  return now - lastSentAt >= LIVE_CHAT_SEND_COOLDOWN_MS;
}

export function msUntilNextLiveChatSend(lastSentAt: number, now = Date.now()): number {
  if (!lastSentAt) return 0;
  return Math.max(0, LIVE_CHAT_SEND_COOLDOWN_MS - (now - lastSentAt));
}

/** Queue rapid incoming messages; flush as one batch to reduce UI redraws. */
export function createLiveChatBatchSink(
  onFlush: (items: LiveChatIncoming[]) => void,
  flushMs = LIVE_CHAT_BATCH_FLUSH_MS,
) {
  let queue: LiveChatIncoming[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    if (!queue.length) return;
    const batch = queue;
    queue = [];
    onFlush(batch);
  };

  return {
    push(sender: string, text: string) {
      const trimmed = String(text || '').trim();
      const name = String(sender || '').trim();
      if (!trimmed || !name) return;
      queue.push({ sender: name, text: trimmed });
      if (!timer) {
        timer = setTimeout(flush, flushMs);
      }
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      queue = [];
    },
  };
}
