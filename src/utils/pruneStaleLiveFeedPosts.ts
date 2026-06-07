import { API_URL } from './constants';

/** Drop feed live cards whose Mongo status is no longer active (missed streamEnded, etc.). */
export async function pruneStaleLiveFeedPosts(posts: any[]): Promise<any[]> {
  const livePosts = posts.filter((p) => p?.isLive && p?.postedBy?._id);
  if (!livePosts.length) return posts;

  const checks = await Promise.all(
    livePosts.map(async (p) => {
      const sid = String(p.postedBy._id);
      try {
        const res = await fetch(`${API_URL}/api/call/livestream/${encodeURIComponent(sid)}/status`, {
          credentials: 'include',
        });
        if (!res.ok) return { postId: String(p._id), active: false };
        const st = await res.json().catch(() => ({}));
        return { postId: String(p._id), active: st?.active === true };
      } catch {
        return { postId: String(p._id), active: true };
      }
    }),
  );

  const inactive = new Set(checks.filter((c) => !c.active).map((c) => c.postId));
  if (!inactive.size) return posts;
  return posts.filter((p) => !inactive.has(String(p._id)));
}
