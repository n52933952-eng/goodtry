import { API_URL } from './constants';

/**
 * `true` / `false` when the status API answers; `null` on network failure (don't guess).
 */
export async function fetchLiveStreamerActive(streamerId: string): Promise<boolean | null> {
  const sid = String(streamerId || '').trim();
  if (!sid) return false;
  try {
    const res = await fetch(`${API_URL}/api/call/livestream/${encodeURIComponent(sid)}/status`, {
      credentials: 'include',
    });
    if (!res.ok) return false;
    const st = await res.json().catch(() => ({}));
    return st?.active === true;
  } catch {
    return null;
  }
}

/** Streamer ids whose live Mongo row is gone (missed streamEnded). */
export async function collectInactiveLiveStreamerIds(streamerIds: string[]): Promise<string[]> {
  const unique = Array.from(
    new Set((streamerIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
  );
  if (!unique.length) return [];
  const checks = await Promise.all(
    unique.map(async (sid) => {
      const active = await fetchLiveStreamerActive(sid);
      return { sid, inactive: active === false };
    }),
  );
  return checks.filter((c) => c.inactive).map((c) => c.sid);
}

/** Drop feed live cards whose Mongo status is no longer active (missed streamEnded, etc.). */
export async function pruneStaleLiveFeedPosts(posts: any[]): Promise<any[]> {
  const livePosts = posts.filter((p) => p?.isLive && p?.postedBy?._id);
  if (!livePosts.length) return posts;

  const inactiveStreamers = new Set(
    await collectInactiveLiveStreamerIds(livePosts.map((p) => String(p.postedBy._id))),
  );
  if (!inactiveStreamers.size) return posts;

  return posts.filter((p) => {
    if (!p?.isLive) return true;
    const authorId = p?.postedBy?._id != null ? String(p.postedBy._id) : '';
    return !inactiveStreamers.has(authorId);
  });
}
