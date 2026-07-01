export const normalizeMessagesSearchQuery = (raw: string): string => {
  let q = String(raw || '').trim();
  if (q.startsWith('@')) q = q.slice(1).trim();
  return q;
};

export const userMatchesMessagesSearchQuery = (u: any, q: string): boolean => {
  const needle = q.toLowerCase();
  if (!needle) return false;
  const username = String(u?.username || '').toLowerCase();
  const name = String(u?.name || '').toLowerCase();
  return username.includes(needle) || name.includes(needle);
};

export const mergeUsersById = (...lists: any[][]): any[] => {
  const byId = new Map<string, any>();
  for (const list of lists) {
    for (const u of list) {
      const id =
        u?._id?.toString?.() ??
        (u?._id != null ? String(u._id) : '');
      if (id) byId.set(id, u);
    }
  }
  return [...byId.values()];
};
