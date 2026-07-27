/**
 * Game cancel / accept emits dropped while socket is down (same race as endLive).
 * Queue once; SocketContext flushes on connect.
 */

type PendingEmit = { event: string; data: Record<string, unknown> };

let pending: PendingEmit | null = null;

export function queuePendingGameEmit(event: string, data: Record<string, unknown>) {
  pending = { event, data };
  console.log('[pendingGameEmit] queued', event, data?.roomId);
}

export function flushPendingGameEmit(emit: (event: string, data?: unknown) => void, isReady: () => boolean) {
  if (!pending || !isReady()) return;
  const { event, data } = pending;
  pending = null;
  emit(event, data);
  console.log('[pendingGameEmit] flushed', event, data?.roomId);
}

export function clearPendingGameEmit() {
  pending = null;
}
