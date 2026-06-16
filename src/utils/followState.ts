/** Normalize Mongo / string user ids for Set lookup. */
export function toUserIdStr(id: unknown): string {
  if (id == null) return '';
  return typeof id === 'string' ? id : (id as { toString?: () => string })?.toString?.() ?? String(id);
}

/**
 * Follow button state: session following[] (synced via /me / follow response)
 * OR server isFollowedByMe when session list may not include this user yet (e.g. followed on web).
 * Explicit isFollowedByMe === false wins (after unfollow before profile refetch).
 */
export function isUserFollowedByMe(
  user: { _id?: unknown; isFollowedByMe?: boolean } | null | undefined,
  followingSet: Set<string>
): boolean {
  const id = toUserIdStr(user?._id);
  if (!id) return false;
  if (followingSet.has(id)) return true;
  if (user?.isFollowedByMe === false) return false;
  return user?.isFollowedByMe === true;
}

/** Search/lists: when session following[] is loaded, trust it only (ignore stale API flags). */
export function isFollowedInSessionList(
  user: { _id?: unknown; isFollowedByMe?: boolean } | null | undefined,
  followingSet: Set<string>,
  sessionFollowingLoaded: boolean
): boolean {
  const id = toUserIdStr(user?._id);
  if (!id) return false;
  if (sessionFollowingLoaded) return followingSet.has(id);
  return isUserFollowedByMe(user, followingSet);
}
