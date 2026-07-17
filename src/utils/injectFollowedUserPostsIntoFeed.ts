import { apiService } from '../services/api';
import type { Post } from '../context/PostContext';
import { ENDPOINTS } from './constants';

const FOLLOW_INJECT_LIMIT = 3;

/**
 * Fetch a newly followed user's latest posts and merge them into the home feed
 * (same behavior as web HomePage `fetchUserPosts` after follow).
 */
export async function injectFollowedUserPostsIntoFeed(
  userId: string | null | undefined,
  injectPostsIntoFeed: (posts: Post[]) => void,
): Promise<void> {
  const id = userId != null ? String(userId).trim() : '';
  if (!id || typeof injectPostsIntoFeed !== 'function') return;

  try {
    const data: any = await apiService.get(
      `${ENDPOINTS.GET_USER_POSTS}/id/${encodeURIComponent(id)}?limit=${FOLLOW_INJECT_LIMIT}`,
    );
    const posts = Array.isArray(data?.posts) ? data.posts : [];
    if (posts.length === 0) return;
    injectPostsIntoFeed(posts as Post[]);
  } catch {
    // Non-fatal: follow already succeeded; feed will catch up on refresh.
  }
}
