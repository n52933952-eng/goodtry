/** Pseudo-post injected at top of feed/profile when a user is live. */

export function normalizeStreamerId(raw: unknown): string {
  if (raw == null) return '';
  const s =
    typeof raw === 'object' && raw !== null && typeof (raw as { toString?: () => string }).toString === 'function'
      ? String((raw as { toString: () => string }).toString()).trim()
      : String(raw).trim();
  return s;
}

export type LiveStreamCardData = {
  streamerId: string;
  streamerName?: string;
  streamerProfilePic?: string;
  roomName?: string;
  username?: string;
};

export function buildLivePseudoPost(data: LiveStreamCardData) {
  const sid = normalizeStreamerId(data.streamerId);
  if (!sid) return null;
  return {
    _id: `live_${sid}`,
    isLive: true,
    liveStreamId: sid,
    roomName: data.roomName || `live_${sid}`,
    postedBy: {
      _id: sid,
      name: data.streamerName,
      profilePic: data.streamerProfilePic,
      username: data.username,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function isLivePseudoPostId(id: unknown): boolean {
  return String(id || '').startsWith('live_');
}
