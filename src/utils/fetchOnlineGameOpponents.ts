import { apiService } from '../services/api';
import { ENDPOINTS } from './constants';

/** How many online opponents to show / load per scroll batch. */
export const GAME_OPPONENT_PAGE_SIZE = 9;
/** How many connections to scan per API call (bigger = fewer round-trips to find online users). */
export const GAME_OPPONENT_SCAN_PAGE_SIZE = 48;

export interface GameOpponentUser {
  _id: string;
  name: string;
  username: string;
  profilePic?: string;
}

export type OpponentListSource = 'following' | 'followers';

export interface OpponentPagerState {
  source: OpponentListSource;
  skip: number;
  done: boolean;
}

export function createOpponentPagerState(): OpponentPagerState {
  return { source: 'following', skip: 0, done: false };
}

function normalizeFollowListResponse(data: any): {
  users: any[];
  hasMore: boolean;
  nextSkip: number;
} {
  if (data && typeof data === 'object' && Array.isArray(data.users)) {
    return {
      users: data.users,
      hasMore: !!data.hasMore,
      nextSkip:
        typeof data.nextSkip === 'number' ? data.nextSkip : data.users.length,
    };
  }
  if (Array.isArray(data)) {
    return { users: data, hasMore: false, nextSkip: data.length };
  }
  return { users: [], hasMore: false, nextSkip: 0 };
}

function toOpponent(u: any): GameOpponentUser | null {
  if (!u?._id) return null;
  const id = String(u._id);
  if (!/^[0-9a-fA-F]{24}$/.test(id)) return null;
  return {
    _id: id,
    name: u.name || u.username || 'User',
    username: u.username || '',
    profilePic: u.profilePic,
  };
}

async function fetchConnectionPage(
  source: OpponentListSource,
  skip: number,
  pageSize: number,
) {
  const endpoint =
    source === 'following'
      ? ENDPOINTS.GET_FOLLOWING_USERS
      : ENDPOINTS.GET_FOLLOWERS_USERS;
  const data = await apiService.get(
    `${endpoint}?limit=${pageSize}&skip=${skip}`,
  );
  return normalizeFollowListResponse(data);
}

/**
 * Load the next batch of online, non-busy opponents (default 9).
 * Pages following first, then followers (API pages of 9) until the batch is full or lists end.
 */
export async function fetchNextOnlineOpponentBatch(options: {
  currentUserId: string;
  isUserOnline: (userId: string) => boolean;
  busyUserIds: Iterable<string>;
  pager: OpponentPagerState;
  alreadyShownIds: Set<string>;
  targetCount?: number;
  connectionPageSize?: number;
  /** Called with each raw connection page before online filtering (e.g. presence subscribe). */
  beforeFilterPage?: (users: GameOpponentUser[]) => void | Promise<void>;
}): Promise<{ users: GameOpponentUser[]; pager: OpponentPagerState }> {
  const {
    currentUserId,
    isUserOnline,
    busyUserIds,
    targetCount = GAME_OPPONENT_PAGE_SIZE,
    connectionPageSize = GAME_OPPONENT_SCAN_PAGE_SIZE,
    beforeFilterPage,
  } = options;

  const pager: OpponentPagerState = { ...options.pager };
  const busy = new Set(
    [...busyUserIds].map((id) => String(id)).filter(Boolean),
  );
  const already = options.alreadyShownIds;
  const myId = String(currentUserId);
  const collected: GameOpponentUser[] = [];

  // Cap API scans so a mostly-offline graph can't loop forever on one press.
  const maxConnectionFetches = 12;
  let fetches = 0;

  while (
    collected.length < targetCount &&
    !pager.done &&
    fetches < maxConnectionFetches
  ) {
    fetches += 1;
    let page;
    try {
      page = await fetchConnectionPage(
        pager.source,
        pager.skip,
        connectionPageSize,
      );
    } catch {
      if (pager.source === 'following') {
        pager.source = 'followers';
        pager.skip = 0;
        continue;
      }
      pager.done = true;
      break;
    }

    const pageUsers: GameOpponentUser[] = [];
    for (const raw of page.users) {
      const u = toOpponent(raw);
      if (u) pageUsers.push(u);
    }
    if (beforeFilterPage && pageUsers.length) {
      await beforeFilterPage(pageUsers);
    }

    for (const u of pageUsers) {
      if (u._id === myId) continue;
      if (already.has(u._id) || collected.some((c) => c._id === u._id)) continue;
      if (!isUserOnline(u._id)) continue;
      if (busy.has(u._id)) continue;
      collected.push(u);
      if (collected.length >= targetCount) break;
    }

    if (page.hasMore) {
      pager.skip = page.nextSkip;
    } else if (pager.source === 'following') {
      pager.source = 'followers';
      pager.skip = 0;
    } else {
      pager.done = true;
    }
  }

  return { users: collected, pager };
}

/** @deprecated Prefer fetchNextOnlineOpponentBatch for scalable paging. */
export async function fetchOnlineGameOpponents(
  currentUserId: string,
  isUserOnline: (userId: string) => boolean,
  busyChessUserIds: string[],
  busyCardUserIds: string[],
): Promise<GameOpponentUser[]> {
  const busy = [...busyChessUserIds, ...busyCardUserIds];
  const already = new Set<string>();
  let pager = createOpponentPagerState();
  const all: GameOpponentUser[] = [];

  while (!pager.done) {
    const { users, pager: next } = await fetchNextOnlineOpponentBatch({
      currentUserId,
      isUserOnline,
      busyUserIds: busy,
      pager,
      alreadyShownIds: already,
      targetCount: GAME_OPPONENT_PAGE_SIZE,
    });
    pager = next;
    for (const u of users) {
      already.add(u._id);
      all.push(u);
    }
    if (users.length === 0 && pager.done) break;
    // Safety: avoid unbounded full scan via deprecated path
    if (all.length >= 500) break;
  }
  return all;
}
