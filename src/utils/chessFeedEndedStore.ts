/**
 * In-memory “this chess room ended for feed UI” — survives missed DeviceEventEmitter
 * (e.g. emit in `beforeRemove` before Home `Post` has subscribed). Same user who ended
 * the game often never gets a reliable `chessGameEnded` echo to self.
 */
const endedRoomIds = new Set<string>();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* ignore */
    }
  });
}

export function markChessRoomFeedEnded(roomId: string): void {
  const s = String(roomId ?? '').trim();
  if (!s) return;
  endedRoomIds.add(s);
  notify();
}

export function isChessRoomFeedEnded(roomId: string): boolean {
  return endedRoomIds.has(String(roomId ?? '').trim());
}

/** Subscribe to any room being marked ended (re-render feed rows). */
export function subscribeChessFeedEndedStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
