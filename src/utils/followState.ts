/** Normalize Mongo / string user ids for Set lookup. */
export function toUserIdStr(id: unknown): string {
  if (id == null) return '';
  return typeof id === 'string' ? id : (id as { toString?: () => string })?.toString?.() ?? String(id);
}

/**
 * Follow button state: session following[] (synced via /me after web follow)
 * OR server isFollowedByMe === true. Stale API false must not hide a real follow.
 */
export function isUserFollowedByMe(
  user: { _id?: unknown; isFollowedByMe?: boolean } | null | undefined,
  followingSet: Set<string>
): boolean {
  const id = toUserIdStr(user?._id);
  if (!id) return false;
  if (followingSet.has(id)) return true;
  return user?.isFollowedByMe === true;
}
