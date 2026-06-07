/** Client-side filter for follower/following/live-share user lists. */

export function filterUsersByQuery(users: any[], query: string): any[] {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return users;
  return users.filter((u) => {
    const name = String(u?.name || '').toLowerCase();
    const username = String(u?.username || '').toLowerCase();
    return name.includes(q) || username.includes(q) || `@${username}`.includes(q);
  });
}
