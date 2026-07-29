/**
 * Clear ghost chess / Go Fish feed cards when end/cancel was missed (socket drop).
 * Same idea as pruneStaleLiveFeedPosts: ask the server who is still in a game;
 * if neither player is busy, the room is dead — mark ended + drop the card locally.
 */

import { API_URL } from './constants';
import { markChessRoomFeedEnded } from './chessFeedEndedStore';
import {
  getCardGameDataForPost,
  getChessGameDataForPost,
  getGameRoomIdFromPost,
  isChessFeedPost,
  isGoFishFeedPost,
} from './gameFeedPostUtils';

async function fetchBusyUserIds(path: string): Promise<string[] | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, { credentials: 'include' });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const ids = (data?.busyUserIds || [])
      .map((x: any) => (x != null ? String(x).trim() : ''))
      .filter(Boolean);
    return ids;
  } catch {
    return null;
  }
}

function playerIdsFromGameData(data: any): string[] {
  if (!data) return [];
  const out: string[] = [];
  for (const key of ['player1', 'player2']) {
    const id = data?.[key]?._id != null ? String(data[key]._id).trim() : '';
    if (id) out.push(id);
  }
  return out;
}

function isStillShowingLiveGameCard(post: any): boolean {
  if (isChessFeedPost(post)) {
    const data = getChessGameDataForPost(post);
    return data?.gameStatus === 'active' || data?.gameStatus == null;
  }
  if (isGoFishFeedPost(post)) {
    const data = getCardGameDataForPost(post);
    return data?.gameStatus === 'active' || data?.gameStatus == null;
  }
  return false;
}

/**
 * Drop chess/card "Playing… Live" cards whose players are no longer in any active game
 * (missed chessGameEnded / cardGameEnded / postDeleted).
 * On network failure, returns posts unchanged (don't guess).
 */
export async function pruneStaleGameFeedPosts(posts: any[]): Promise<any[]> {
  if (!Array.isArray(posts) || posts.length === 0) return posts;

  const candidates = posts.filter(
    (p) => (isChessFeedPost(p) || isGoFishFeedPost(p)) && isStillShowingLiveGameCard(p),
  );
  if (!candidates.length) return posts;

  const needsChess = candidates.some((p) => isChessFeedPost(p));
  const needsCard = candidates.some((p) => isGoFishFeedPost(p));

  const [chessBusy, cardBusy] = await Promise.all([
    needsChess ? fetchBusyUserIds('/api/user/busyChessUsers') : Promise.resolve([] as string[]),
    needsCard ? fetchBusyUserIds('/api/user/busyCardUsers') : Promise.resolve([] as string[]),
  ]);

  // Network failure — leave feed alone (same as live prune).
  if (needsChess && chessBusy == null) return posts;
  if (needsCard && cardBusy == null) return posts;

  const chessBusySet = new Set(chessBusy || []);
  const cardBusySet = new Set(cardBusy || []);
  const staleRoomIds = new Set<string>();
  const stalePostIds = new Set<string>();

  for (const post of candidates) {
    const roomId = getGameRoomIdFromPost(post);
    const isChess = isChessFeedPost(post);
    const data = isChess ? getChessGameDataForPost(post) : getCardGameDataForPost(post);
    const players = playerIdsFromGameData(data);
    if (!players.length && !roomId) continue;

    const busySet = isChess ? chessBusySet : cardBusySet;
    const anyoneStillBusy = players.some((id) => busySet.has(id));
    if (anyoneStillBusy) continue;

    if (roomId) {
      staleRoomIds.add(roomId);
      markChessRoomFeedEnded(roomId);
    }
    const pid = post?._id != null ? String(post._id) : '';
    if (pid) stalePostIds.add(pid);
  }

  if (!stalePostIds.size && !staleRoomIds.size) return posts;

  return posts.filter((p) => {
    const pid = p?._id != null ? String(p._id) : '';
    if (pid && stalePostIds.has(pid)) return false;
    const rid = getGameRoomIdFromPost(p);
    if (rid && staleRoomIds.has(rid)) return false;
    return true;
  });
}
