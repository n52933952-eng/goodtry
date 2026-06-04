/**
 * One feed card per chess/card game (same roomId) when viewer follows both players.
 * Go Fish text-only posts dedupe by sorted player display names when roomId is absent.
 */

import {
  getGameFeedDedupeKey,
  getGameRoomIdFromPost,
  mergeGameFeedPostData,
} from './gameFeedPostUtils';

export { getGameRoomIdFromPost };

export function dedupeGamePostsForFeed<T extends { _id?: unknown }>(posts: T[]): T[] {
  if (!Array.isArray(posts) || posts.length === 0) return posts;
  const keyToIndex = new Map<string, number>();
  const out: T[] = [];
  for (const post of posts) {
    const key = getGameFeedDedupeKey(post);
    if (!key) {
      out.push(post);
      continue;
    }
    const idx = keyToIndex.get(key);
    if (idx === undefined) {
      keyToIndex.set(key, out.length);
      out.push(post);
      continue;
    }
    out[idx] = mergeGameFeedPostData(out[idx], post) as T;
  }
  return out;
}
