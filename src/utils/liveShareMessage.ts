/** Compact live-share payload embedded in chat message `text`. */

export const LIVE_SHARE_PREFIX = 'LIVE_SHARE:';

export type LiveSharePayload = {
  streamerId: string;
  streamerName: string;
  streamerProfilePic?: string;
  roomName?: string;
};

export function buildLiveShareMessage(payload: LiveSharePayload): string {
  return `${LIVE_SHARE_PREFIX}${JSON.stringify({
    streamerId: String(payload.streamerId || ''),
    streamerName: String(payload.streamerName || 'User'),
    streamerProfilePic: payload.streamerProfilePic || '',
    roomName: payload.roomName || '',
  })}`;
}

export function parseLiveShareMessage(text?: string): LiveSharePayload | null {
  const raw = String(text || '');
  if (!raw.startsWith(LIVE_SHARE_PREFIX)) return null;
  try {
    const data = JSON.parse(raw.slice(LIVE_SHARE_PREFIX.length));
    const streamerId = data?.streamerId != null ? String(data.streamerId) : '';
    if (!streamerId) return null;
    return {
      streamerId,
      streamerName: String(data?.streamerName || 'User'),
      streamerProfilePic: data?.streamerProfilePic ? String(data.streamerProfilePic) : '',
      roomName: data?.roomName ? String(data.roomName) : '',
    };
  } catch {
    return null;
  }
}

export function liveSharePreviewText(text?: string): string | null {
  const live = parseLiveShareMessage(text);
  if (!live) return null;
  return `🔴 ${live.streamerName} is live`;
}
