/**
 * Latest unique commenters for the feed avatar stack.
 * Prefers API `replyPreview`; falls back to embedded `replies[]` on post detail.
 */
export function getReplyPreviewUsers(post: any, max = 3): Array<{
  _id?: any;
  username?: string;
  name?: string;
  profilePic?: string | null;
}> {
  if (Array.isArray(post?.replyPreview) && post.replyPreview.length > 0) {
    return post.replyPreview.slice(0, max);
  }
  const replies = Array.isArray(post?.replies) ? post.replies : [];
  const seen = new Set<string>();
  const out: Array<{
    _id?: any;
    username?: string;
    name?: string;
    profilePic?: string | null;
  }> = [];
  for (let i = replies.length - 1; i >= 0 && out.length < max; i -= 1) {
    const r = replies[i];
    const id = String(r?.userId?._id || r?.userId || r?.username || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      _id: r.userId,
      username: r.username,
      name: r.name || r.username,
      profilePic: r.userProfilePic || null,
    });
  }
  return out;
}
