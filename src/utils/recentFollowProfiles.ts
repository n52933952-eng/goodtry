/**
 * Tiny in-memory cache of recently followed users (id + display fields only).
 * Lets Messages search show someone right after Follow without global user search
 * or loading the full following list.
 */
export type RecentFollowProfile = {
  _id: string;
  username?: string;
  name?: string;
  profilePic?: string;
};

const MAX_RECENT = 32;
const byId = new Map<string, RecentFollowProfile>();
const listeners = new Set<() => void>();

const notify = () => {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch (_) {
      /* ignore */
    }
  });
};

const toId = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return (value as { toString?: () => string })?.toString?.() ?? String(value);
};

export const rememberFollowProfile = (user: {
  _id?: unknown;
  username?: string;
  name?: string;
  profilePic?: string;
}) => {
  const id = toId(user?._id);
  if (!id) return;

  byId.delete(id);
  byId.set(id, {
    _id: id,
    username: user.username,
    name: user.name,
    profilePic: user.profilePic,
  });

  while (byId.size > MAX_RECENT) {
    const oldest = byId.keys().next().value;
    if (!oldest) break;
    byId.delete(oldest);
  }

  notify();
};

export const removeFollowProfile = (userId: unknown) => {
  const id = toId(userId);
  if (!id || !byId.has(id)) return;
  byId.delete(id);
  notify();
};

export const searchRecentFollowProfiles = (rawQuery: string): RecentFollowProfile[] => {
  let q = String(rawQuery || '').trim();
  if (q.startsWith('@')) q = q.slice(1).trim();
  const needle = q.toLowerCase();
  if (!needle) return [];

  return [...byId.values()].filter((u) => {
    const username = String(u.username || '').toLowerCase();
    const name = String(u.name || '').toLowerCase();
    return username.includes(needle) || name.includes(needle);
  });
};

export const subscribeRecentFollowProfiles = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
