import React, { createContext, useState, useContext, useEffect, useCallback, useRef, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useUser } from './UserContext';
import { mergePostUpdate } from '../utils/postMerge';
import { dedupeGamePostsForFeed } from '../utils/dedupeGameFeedPosts';
import { getGameFeedDedupeKey, mergeGameFeedPostData } from '../utils/gameFeedPostUtils';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';

const feedHiddenStorageKey = (userId: string) => `feed_hidden_post_ids_${userId}`;
const feedHiddenSourcesKey = (userId: string) => `feed_hidden_sources_${userId}`;

/** Max posts kept in memory while scrolling — prevents FlatList from growing forever (RAM / jank). */
export const FEED_IN_MEMORY_MAX_POSTS = 300;

/** Brief bump so a newly added channel is visible now; expires so refresh stays chronological. */
const VIEWER_SORT_BOOST_TTL_MS = 45_000;

/** Matches backend `FEED_FIRST_PAGE_NORMAL_COUNT` — channels only mix with this first block. */
const FEED_FIRST_PAGE_NORMAL_COUNT = 12;

/** Viewer-added live-TV channel cards (same as backend `channelAddedBy` query). */
const isViewerChannelCard = (p: any): boolean =>
  !!(p?.channelAddedBy != null && String(p.channelAddedBy).trim() !== '');

const trimFeedPostsToMax = (list: Post[]): Post[] => {
  const safe = Array.isArray(list) ? list : [];
  if (safe.length <= FEED_IN_MEMORY_MAX_POSTS) return safe;
  // Newest-first: keep the top window, drop oldest scrolled past at the bottom.
  const live = safe.filter((p) => (p as any)?.isLive);
  const normal = safe.filter((p) => !(p as any)?.isLive);
  const maxNormal = FEED_IN_MEMORY_MAX_POSTS - live.length;
  if (maxNormal <= 0) return live.slice(0, FEED_IN_MEMORY_MAX_POSTS);
  return [...live, ...normal.slice(0, maxNormal)];
};

export interface Post {
  _id: string;
  postedBy: {
    _id: string;
    name: string;
    username: string;
    profilePic?: string;
  };
  text: string;
  img?: string;
  thumbnail?: string;
  isCollaborative?: boolean;
  contributors?: any[];
  /** Collaborative album: one image per contributor (including owner). */
  collaboratorImages?: { userId: string; img: string }[];
  /** Up to 4 carousel images; `img` mirrors images[0]. */
  images?: string[];
  /** Optional MP3/audio for carousel posts. */
  audio?: string;
  likes: string[];
  /** Denormalized like count (source of truth; the raw `likes` array is stripped server-side). */
  likeCount?: number;
  /** Whether the current viewer liked this post. */
  likedByMe?: boolean;
  /** Most-recent liker preview for the inline "liked by [avatar]" UI. */
  likePreview?: {
    _id: string;
    username?: string;
    name?: string;
    profilePic?: string | null;
  } | null;
  replies: any[];
  /** Denormalized comment count (feed/detail omit full replies[]). */
  replyCount?: number;
  /** Latest unique commenters for feed avatar preview (from API). */
  replyPreview?: Array<{
    _id?: string;
    username?: string;
    name?: string;
    profilePic?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
  editedAt?: string | null;
  // Special post types
  isWeatherPost?: boolean;
  isFootballPost?: boolean;
  weatherData?: any;
  footballData?: any;
  chessGameData?: string; // JSON string containing chess game data
  cardGameData?: string; // JSON string containing card game data
  /** Set when this post is a channel the viewer added; keeps card in pinned block vs normal feed sort. */
  channelAddedBy?: string;
  /** Ephemeral client-only sort boost (ms since epoch). Used to bubble items like re-added channels. */
  __viewerSortBoostMs?: number;
  /** Live stream pseudo-post; kept above the feed block so it does not reorder Football/Weather/normals. */
  isLive?: boolean;
}

interface PostContextType {
  posts: Post[];
  setPosts: (posts: Post[] | ((prev: Post[]) => Post[])) => void;
  /** Append new posts at the end without re-sorting existing posts (used for load more). */
  appendPosts: (newPosts: Post[]) => void;
  addPost: (post: Post) => void;
  /**
   * Merge posts into the feed immediately (does not queue behind "New posts").
   * Used when following someone so their recent posts appear on the home feed.
   */
  injectPostsIntoFeed: (incoming: Post[]) => void;
  updatePost: (postId: string, updates: Partial<Post>) => void;
  deletePost: (postId: string) => void;
  likePost: (
    postId: string,
    patch: {
      likedByMe?: boolean;
      likeCount?: number;
      likePreview?: Post['likePreview'];
    },
  ) => void;
  unlikePost: (
    postId: string,
    patch?: {
      likedByMe?: boolean;
      likeCount?: number;
      likePreview?: Post['likePreview'];
    },
  ) => void;
  addComment: (postId: string, comment: any) => void;
  /** Post IDs the user hid from feed ("not interested"); synced from server per account. */
  hiddenFeedPostIds: Set<string>;
  /** Usernames the user hid from feed (system cards like Football/Weather); persisted locally. */
  hiddenFeedSources: Set<string>;
  hideFeedPostFromFeed: (postId: string) => Promise<void>;
  hideFeedSourceFromFeed: (username: string) => void;
  /** Replace hidden post ids from server (login sync). */
  syncHiddenFeedPostIds: (ids: string[]) => void;
  /** Add one hidden post id after hide/leave (no full list from server). */
  addHiddenFeedPostId: (postId: string) => void;
  /** Clear hidden IDs so dismissed feed cards can show again (e.g., after re-follow / re-adding channels). */
  clearHiddenFeedPosts: () => void;
  /** Unhide a specific post id (e.g., re-add one channel without restoring all). */
  unhideFeedPostFromFeed: (postId: string) => void;
  unhideFeedSourceFromFeed: (username: string) => void;
  /** Client-only: bubble a post to top briefly (expires; pull-refresh clears). */
  setViewerSortBoost: (postId: string, boostMs?: number) => void;
  clearViewerSortBoosts: () => void;
  filterPostsForFeed: (list: Post[]) => Post[];
  /**
   * Merge a feed API page into local state without wiping socket inserts / deletes.
   * Used on focus refresh; pull-to-refresh should still use setPosts for a full replace.
   */
  mergeApiFeedPage: (apiPosts: Post[]) => void;
  /** When true, socket/live inserts queue until flush (feed scrolled down — avoids scroll jump). */
  setDeferIncomingFeedPosts: (defer: boolean) => void;
  flushPendingFeedPosts: () => void;
  clearPendingFeedPosts: () => void;
  pendingNewPostsCount: number;
}

const PostContext = createContext<PostContextType | undefined>(undefined);

export const PostProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const [posts, setPosts] = useState<Post[]>([]);
  const [hiddenFeedPostIds, setHiddenFeedPostIds] = useState<Set<string>>(new Set());
  const hiddenFeedPostIdsRef = useRef<Set<string>>(new Set());
  const [hiddenFeedSources, setHiddenFeedSources] = useState<Set<string>>(new Set());
  const hiddenFeedSourcesRef = useRef<Set<string>>(new Set());
  const viewerSortBoostRef = useRef<Record<string, number>>({});
  /** Posts removed via socket/UI — API refresh must not revive them from Redis cache. */
  const removedPostIdsRef = useRef<Set<string>>(new Set());
  /** Queue incoming posts while the user is scrolled down — prevents FlatList jump. */
  const deferIncomingFeedPostsRef = useRef(false);
  const pendingNewPostsRef = useRef<Post[]>([]);
  const [pendingNewPostsCount, setPendingNewPostsCount] = useState(0);

  const getSortTimeMs = (p: any): number => {
    const id = p?._id?.toString?.() ?? (p?._id != null ? String(p._id) : '');
    const mapBoostRaw = id && viewerSortBoostRef.current[id] ? viewerSortBoostRef.current[id] : 0;
    const mapBoost =
      mapBoostRaw && Date.now() - mapBoostRaw < VIEWER_SORT_BOOST_TTL_MS ? mapBoostRaw : 0;
    if (mapBoostRaw && !mapBoost && id) {
      delete viewerSortBoostRef.current[id];
    }
    const inlineBoost = typeof p?.__viewerSortBoostMs === 'number' ? p.__viewerSortBoostMs : 0;
    const boost = Math.max(mapBoost || 0, inlineBoost || 0);
    const base = new Date(p?.updatedAt || p?.createdAt || 0).getTime();
    return Math.max(base || 0, boost || 0);
  };

  const sortPostsNewestFirst = useCallback(
    (list: Post[]) => {
      const safe = Array.isArray(list) ? list : [];
      // Live on top. Channel cards only mix with the first 12 normals (same as server page 1).
      // Extra normals from load-more / realtime stay below that block.
      const live: Post[] = [];
      const channels: Post[] = [];
      const normals: Post[] = [];
      for (const p of safe) {
        if (p && (p as any).isLive) live.push(p);
        else if (isViewerChannelCard(p)) channels.push(p);
        else normals.push(p);
      }
      normals.sort((a: any, b: any) => getSortTimeMs(b) - getSortTimeMs(a));
      const firstNormals = normals.slice(0, FEED_FIRST_PAGE_NORMAL_COUNT);
      const restNormals = normals.slice(FEED_FIRST_PAGE_NORMAL_COUNT);
      const mixedPage1 = [...channels, ...firstNormals].sort(
        (a: any, b: any) => getSortTimeMs(b) - getSortTimeMs(a),
      );
      return [...live, ...mixedPage1, ...restNormals];
    },
    [],
  );

  useEffect(() => {
    hiddenFeedPostIdsRef.current = hiddenFeedPostIds;
  }, [hiddenFeedPostIds]);
  useEffect(() => {
    hiddenFeedSourcesRef.current = hiddenFeedSources;
  }, [hiddenFeedSources]);

  // Load dismissed feed cards (Football / Weather / channels) per user
  useEffect(() => {
    if (!user?._id) {
      setHiddenFeedPostIds(new Set());
      hiddenFeedPostIdsRef.current = new Set();
      setHiddenFeedSources(new Set());
      hiddenFeedSourcesRef.current = new Set();
      return;
    }
    let cancelled = false;
    AsyncStorage.getItem(feedHiddenStorageKey(String(user._id)))
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const ids: string[] = JSON.parse(raw);
          if (Array.isArray(ids)) {
            const next = new Set(ids.map(String));
            setHiddenFeedPostIds(next);
            hiddenFeedPostIdsRef.current = next;
          }
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});

    apiService
      .get(ENDPOINTS.GET_HIDDEN_FEED_POST_IDS)
      .then((data: any) => {
        if (cancelled || !Array.isArray(data?.postIds)) return;
        const next = new Set(data.postIds.map(String));
        setHiddenFeedPostIds(next);
        hiddenFeedPostIdsRef.current = next;
        AsyncStorage.setItem(feedHiddenStorageKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
      })
      .catch(() => {});

    AsyncStorage.getItem(feedHiddenSourcesKey(String(user._id)))
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          const ids: string[] = JSON.parse(raw);
          if (Array.isArray(ids)) {
            const next = new Set(ids.map((x) => String(x).trim()).filter(Boolean));
            setHiddenFeedSources(next);
            hiddenFeedSourcesRef.current = next;
          }
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [user?._id]);

  // Drop feed when logged out or between accounts so a new session never flashes the prior user's posts.
  useEffect(() => {
    if (!user?._id) {
      setPosts([]);
    }
  }, [user?._id]);

  const filterPostsForFeed = useCallback((list: Post[]) => {
    const hidden = hiddenFeedPostIdsRef.current;
    const sources = hiddenFeedSourcesRef.current;
    const filtered = (Array.isArray(list) ? list : []).filter((p: any) => {
      const idOk = p?._id && !hidden.has(String(p._id));
      if (!idOk) return false;
      const uname = p?.postedBy?.username ? String(p.postedBy.username) : '';
      if (uname && sources.has(uname)) return false;
      return true;
    });
    return dedupeGamePostsForFeed(filtered);
  }, []);

  // When hidden IDs load from storage (or change), drop those posts from the current feed list
  useEffect(() => {
    setPosts((prev) => filterPostsForFeed(prev));
  }, [hiddenFeedPostIds, filterPostsForFeed]);

  const hideFeedPostFromFeed = useCallback(
    async (postId: string) => {
      const id = String(postId);
      const data: any = await apiService.put(`${ENDPOINTS.HIDE_FEED_POST}/${id}`);
      const hiddenId = String(data?.postId || id);
      setHiddenFeedPostIds((prev) => {
        const next = new Set(prev);
        next.add(hiddenId);
        hiddenFeedPostIdsRef.current = next;
        if (user?._id) {
          AsyncStorage.setItem(feedHiddenStorageKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
        }
        return next;
      });
      setPosts((prev) => prev.filter((p) => String(p._id) !== id));
    },
    [user?._id]
  );

  const syncHiddenFeedPostIds = useCallback(
    (ids: string[]) => {
      const next = new Set((Array.isArray(ids) ? ids : []).map(String));
      setHiddenFeedPostIds(next);
      hiddenFeedPostIdsRef.current = next;
      if (user?._id) {
        AsyncStorage.setItem(feedHiddenStorageKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
      }
    },
    [user?._id],
  );

  const addHiddenFeedPostId = useCallback(
    (postId: string) => {
      const id = String(postId || '').trim();
      if (!id) return;
      setHiddenFeedPostIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        hiddenFeedPostIdsRef.current = next;
        if (user?._id) {
          AsyncStorage.setItem(feedHiddenStorageKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
        }
        return next;
      });
    },
    [user?._id],
  );

  const hideFeedSourceFromFeed = useCallback(
    (username: string) => {
      const uname = String(username || '').trim();
      if (!uname) return;
      setHiddenFeedSources((prev) => {
        const next = new Set(prev);
        next.add(uname);
        hiddenFeedSourcesRef.current = next;
        if (user?._id) {
          AsyncStorage.setItem(feedHiddenSourcesKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
        }
        return next;
      });
      // Drop any current posts from that source immediately
      setPosts((prev) => (Array.isArray(prev) ? prev.filter((p: any) => String(p?.postedBy?.username || '') !== uname) : []));
    },
    [user?._id],
  );

  const clearHiddenFeedPosts = useCallback(() => {
    const uid = user?._id ? String(user._id) : '';
    setHiddenFeedPostIds(new Set());
    hiddenFeedPostIdsRef.current = new Set();
    if (uid) {
      AsyncStorage.removeItem(feedHiddenStorageKey(uid)).catch(() => {});
    }
  }, [user?._id]);

  const unhideFeedPostFromFeed = useCallback(
    (postId: string) => {
      const id = String(postId || '').trim();
      if (!id) return;
      setHiddenFeedPostIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        hiddenFeedPostIdsRef.current = next;
        if (user?._id) {
          AsyncStorage.setItem(feedHiddenStorageKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
        }
        return next;
      });
    },
    [user?._id],
  );

  const unhideFeedSourceFromFeed = useCallback(
    (username: string) => {
      const uname = String(username || '').trim();
      if (!uname) return;
      setHiddenFeedSources((prev) => {
        if (!prev.has(uname)) return prev;
        const next = new Set(prev);
        next.delete(uname);
        hiddenFeedSourcesRef.current = next;
        if (user?._id) {
          AsyncStorage.setItem(feedHiddenSourcesKey(String(user._id)), JSON.stringify([...next])).catch(() => {});
        }
        return next;
      });
    },
    [user?._id],
  );

  const mergePostIntoFeed = useCallback((prevPosts: Post[], post: Post): Post[] => {
    const safeArray = Array.isArray(prevPosts) ? prevPosts : [];

    const newId = post?._id?.toString?.() ?? String(post?._id);
    if (!newId) return safeArray;
    if (hiddenFeedPostIdsRef.current.has(newId)) return safeArray;

    const newGameKey = getGameFeedDedupeKey(post);
    if (newGameKey) {
      const dupIdx = safeArray.findIndex((p) => getGameFeedDedupeKey(p) === newGameKey);
      if (dupIdx >= 0) {
        const merged = mergeGameFeedPostData(safeArray[dupIdx], post);
        if (merged === safeArray[dupIdx]) return safeArray;
        const next = [...safeArray];
        next[dupIdx] = merged as Post;
        return sortPostsNewestFirst(next);
      }
    }

    const withoutDup = safeArray.filter((p) => {
      const pId = p?._id?.toString?.() ?? String(p._id);
      return pId && pId !== newId;
    });

    const newAuthorId =
      (post as any)?.postedBy?._id?.toString?.() ??
      (post as any)?.postedBy?.toString?.() ??
      null;

    if (!newAuthorId) {
      return trimFeedPostsToMax(sortPostsNewestFirst([post, ...withoutDup]));
    }

    const fromSameAuthor: any[] = [];
    const fromOtherAuthors: any[] = [];
    withoutDup.forEach((p: any) => {
      const authorId = p?.postedBy?._id?.toString?.() ?? p?.postedBy?.toString?.();
      if (authorId === newAuthorId) fromSameAuthor.push(p);
      else fromOtherAuthors.push(p);
    });

    fromSameAuthor.sort((a: any, b: any) => getSortTimeMs(b) - getSortTimeMs(a));

    const keptSameAuthor = fromSameAuthor.slice(0, 2);
    const updated = [post, ...keptSameAuthor, ...fromOtherAuthors];
    // sortPostsNewestFirst keeps channels in the first-page block with top 12 normals.
    return trimFeedPostsToMax(sortPostsNewestFirst(updated));
  }, [sortPostsNewestFirst]);

  const queuePendingFeedPost = useCallback((post: Post) => {
    const newId = post?._id?.toString?.() ?? String(post?._id);
    if (!newId || hiddenFeedPostIdsRef.current.has(newId)) return;
    const pending = pendingNewPostsRef.current;
    if (pending.some((p) => String(p._id) === newId)) return;
    pendingNewPostsRef.current = [post, ...pending];
    setPendingNewPostsCount(pendingNewPostsRef.current.length);
  }, []);

  const setDeferIncomingFeedPosts = useCallback((defer: boolean) => {
    deferIncomingFeedPostsRef.current = defer;
  }, []);

  const clearPendingFeedPosts = useCallback(() => {
    pendingNewPostsRef.current = [];
    setPendingNewPostsCount(0);
  }, []);

  const flushPendingFeedPosts = useCallback(() => {
    const pending = pendingNewPostsRef.current.splice(0);
    setPendingNewPostsCount(0);
    if (!pending.length) return;
    setPosts((prev) => {
      let next = prev;
      for (let i = pending.length - 1; i >= 0; i--) {
        next = mergePostIntoFeed(next, pending[i]);
      }
      return next;
    });
  }, [mergePostIntoFeed]);

  const addPost = useCallback((post: Post) => {
    const id = post?._id != null ? String(post._id) : '';
    if (id && removedPostIdsRef.current.has(id)) {
      return;
    }
    if (deferIncomingFeedPostsRef.current) {
      queuePendingFeedPost(post);
      return;
    }
    setPosts((prevPosts) => mergePostIntoFeed(prevPosts, post));
  }, [mergePostIntoFeed, queuePendingFeedPost]);

  const injectPostsIntoFeed = useCallback(
    (incoming: Post[]) => {
      if (!Array.isArray(incoming) || incoming.length === 0) return;
      // Oldest first so mergePostIntoFeed's insert-at-front leaves newest on top.
      const sorted = [...incoming].sort((a, b) => getSortTimeMs(a) - getSortTimeMs(b));
      setPosts((prev) => {
        let next = prev;
        for (const post of sorted) {
          next = mergePostIntoFeed(next, post);
        }
        return next;
      });
    },
    [mergePostIntoFeed],
  );

  const updatePost = useCallback((postId: string, updates: Partial<Post>) => {
    setPosts((prevPosts) => {
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      const target = String(postId);
      const next = safeArray.map((post) =>
        String(post._id) === target ? mergePostUpdate(post, updates) : post,
      );
      return sortPostsNewestFirst(next);
    });
  }, [sortPostsNewestFirst]);

  const setViewerSortBoost = useCallback(
    (postId: string, boostMs?: number) => {
      const id = String(postId || '').trim();
      if (!id) return;
      const ms = typeof boostMs === 'number' && Number.isFinite(boostMs) ? boostMs : Date.now();
      viewerSortBoostRef.current[id] = ms;
      setPosts((prev) => sortPostsNewestFirst(prev));
    },
    [sortPostsNewestFirst],
  );

  const clearViewerSortBoosts = useCallback(() => {
    viewerSortBoostRef.current = {};
    setPosts((prev) => sortPostsNewestFirst(prev));
  }, [sortPostsNewestFirst]);

  const deletePost = useCallback((postId: string) => {
    if (!postId) {
      console.warn('⚠️ [PostContext] deletePost called with empty postId');
      return;
    }

    const targetIdStr = postId?.toString?.() ?? String(postId);
    if (targetIdStr) removedPostIdsRef.current.add(String(targetIdStr).trim());
    
    setPosts((prevPosts) => {
      // Safety check: ensure prevPosts is an array
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      const beforeCount = safeArray.length;
      
      // Normalize the target postId
      const targetIdStr = postId?.toString?.() ?? String(postId);
      
      const filtered = safeArray.filter((post) => {
        // Normalize post._id for comparison - handle multiple formats
        let postIdStr = '';
        if (post._id) {
          if (typeof post._id === 'string') {
            postIdStr = post._id.trim();
          } else if (post._id.toString) {
            postIdStr = post._id.toString().trim();
          } else {
            postIdStr = String(post._id).trim();
          }
        } else {
          postIdStr = String(post._id).trim();
        }
        
        // Normalize target ID
        let normalizedTarget = targetIdStr;
        if (typeof normalizedTarget !== 'string') {
          if (normalizedTarget?.toString) {
            normalizedTarget = normalizedTarget.toString();
          } else {
            normalizedTarget = String(normalizedTarget);
          }
        }
        normalizedTarget = normalizedTarget.trim();
        
        // Compare (exact match, case-sensitive for MongoDB ObjectIds)
        const matches = postIdStr === normalizedTarget;
        
        // Log if we found a match
        if (matches) {
          console.log(`✅ [PostContext] Found matching post to delete: "${postIdStr}" === "${normalizedTarget}"`);
        } else {
          // Log first non-match for debugging
          if (safeArray.indexOf(post) === 0) {
            console.log(`🔍 [PostContext] Comparing: feed post ID="${postIdStr}" (type: ${typeof post._id}) vs target="${normalizedTarget}" (type: ${typeof targetIdStr})`);
          }
        }
        
        return !matches;
      });
      
      const afterCount = filtered.length;
      const deletedCount = beforeCount - afterCount;
      
      if (deletedCount > 0) {
        console.log(`✅ [PostContext] Deleted ${deletedCount} post(s) with ID ${targetIdStr} from feed (${beforeCount} -> ${afterCount} posts)`);
      } else {
        const availableIds = safeArray.map(p => {
          if (typeof p._id === 'string') return p._id;
          if (p._id?.toString) return p._id.toString();
          return String(p._id);
        });
        console.log(`ℹ️ [PostContext] Post "${targetIdStr}" not found in feed (${beforeCount} posts).`);
        console.log(`ℹ️ [PostContext] Available post IDs:`, availableIds);
        console.log(`ℹ️ [PostContext] Looking for:`, targetIdStr);
        console.log(`ℹ️ [PostContext] Post details:`, safeArray.map(p => {
          const postIdStr = typeof p._id === 'string' ? p._id : (p._id?.toString?.() ?? String(p._id));
          return { 
            _id: p._id, 
            _idType: typeof p._id,
            _idString: postIdStr,
            _idMatches: postIdStr === targetIdStr,
            text: p.text?.substring(0, 50),
            hasCardGameData: !!p.cardGameData
          };
        }));
        
        // Fallback: Try to find by cardGameData.roomId if it's a card game post
        // This helps when the post ID format doesn't match but we know the roomId
        const cardGamePosts = safeArray.filter(p => p.cardGameData);
        if (cardGamePosts.length > 0) {
          console.log(`🔍 [PostContext] Found ${cardGamePosts.length} card game post(s) in feed, checking if any should be deleted...`);
        }
      }
      
      return filtered;
    });
  }, []);

  const likePost = useCallback((postId: string, patch: {
    likedByMe?: boolean;
    likeCount?: number;
    likePreview?: Post['likePreview'];
  }) => {
    setPosts((prevPosts) => {
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        String(post._id) === String(postId)
          ? {
              ...post,
              likedByMe: patch.likedByMe ?? true,
              likeCount:
                typeof patch.likeCount === 'number'
                  ? patch.likeCount
                  : (post.likeCount ?? post.likes?.length ?? 0) + 1,
              likePreview:
                patch.likePreview !== undefined ? patch.likePreview : post.likePreview,
            }
          : post,
      );
    });
  }, []);

  const unlikePost = useCallback((postId: string, patch: {
    likedByMe?: boolean;
    likeCount?: number;
    likePreview?: Post['likePreview'];
  } = {}) => {
    setPosts((prevPosts) => {
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        String(post._id) === String(postId)
          ? {
              ...post,
              likedByMe: patch.likedByMe ?? false,
              likeCount:
                typeof patch.likeCount === 'number'
                  ? patch.likeCount
                  : Math.max(0, (post.likeCount ?? post.likes?.length ?? 0) - 1),
              likePreview:
                patch.likePreview !== undefined ? patch.likePreview : post.likePreview,
            }
          : post,
      );
    });
  }, []);

  const appendPosts = useCallback((newPosts: Post[]) => {
    setPosts((prev) => {
      const safeArray = Array.isArray(prev) ? prev : [];
      const existingIds = new Set(safeArray.map((p) => String(p._id)));
      const removed = removedPostIdsRef.current;
      const fresh = (Array.isArray(newPosts) ? newPosts : []).filter(
        (p) => p?._id && !existingIds.has(String(p._id)) && !removed.has(String(p._id))
      );
      // Keep existing order intact, only append fresh posts at end; cap total in memory.
      return trimFeedPostsToMax(filterPostsForFeed([...safeArray, ...fresh]));
    });
  }, [filterPostsForFeed]);

  /** Silent/focus refresh: keep socket-fresh posts and never revive tombstoned deletes. */
  const mergeApiFeedPage = useCallback(
    (apiPosts: Post[]) => {
      setPosts((prev) => {
        const removed = removedPostIdsRef.current;
        const fromApi = (Array.isArray(apiPosts) ? apiPosts : []).filter((p) => {
          const id = p?._id != null ? String(p._id) : '';
          return id && !removed.has(id);
        });
        const apiIds = new Set(fromApi.map((p) => String(p._id)));
        const now = Date.now();
        const keepLocal = (Array.isArray(prev) ? prev : []).filter((p) => {
          const id = p?._id != null ? String(p._id) : '';
          if (!id || removed.has(id)) return false;
          if ((p as any)?.isLive) return true;
          if (apiIds.has(id)) return false;
          const t = new Date((p as any).updatedAt || (p as any).createdAt).getTime();
          if (!Number.isFinite(t)) return false;
          return now - t < 3 * 60 * 1000;
        });
        const byId = new Map<string, Post>();
        for (const p of [...fromApi, ...keepLocal]) {
          const id = p?._id != null ? String(p._id) : '';
          if (!id || removed.has(id)) continue;
          const prevP = byId.get(id);
          if (!prevP) {
            byId.set(id, p);
            continue;
          }
          const pt = new Date((prevP as any).updatedAt || (prevP as any).createdAt).getTime();
          const nt = new Date((p as any).updatedAt || (p as any).createdAt).getTime();
          if (nt >= pt) byId.set(id, p);
        }
        return Array.from(byId.values());
      });
    },
    [],
  );

  const addComment = useCallback((postId: string, comment: any) => {
    setPosts((prevPosts) => {
      const safeArray = Array.isArray(prevPosts) ? prevPosts : [];
      return safeArray.map((post) =>
        post._id === postId
          ? {
              ...post,
              replies: [...(post.replies || []), comment],
              replyCount: (post.replyCount ?? post.replies?.length ?? 0) + 1,
            }
          : post
      );
    });
  }, []);

  return (
    <PostContext.Provider
      value={{
        posts,
        setPosts: (next) =>
          setPosts((prev) => {
            const computed = typeof next === 'function' ? (next as (p: Post[]) => Post[])(prev) : next;
            const removed = removedPostIdsRef.current;
            const withoutRemoved = (Array.isArray(computed) ? computed : []).filter((p) => {
              const id = p?._id != null ? String(p._id) : '';
              return id && !removed.has(id);
            });
            return trimFeedPostsToMax(sortPostsNewestFirst(filterPostsForFeed(withoutRemoved)));
          }),
        appendPosts,
        addPost,
        injectPostsIntoFeed,
        updatePost,
        deletePost,
        likePost,
        unlikePost,
        addComment,
        hiddenFeedPostIds,
        hiddenFeedSources,
        hideFeedPostFromFeed,
        hideFeedSourceFromFeed,
        syncHiddenFeedPostIds,
        addHiddenFeedPostId,
        clearHiddenFeedPosts,
        unhideFeedPostFromFeed,
        unhideFeedSourceFromFeed,
        setViewerSortBoost,
        clearViewerSortBoosts,
        filterPostsForFeed,
        mergeApiFeedPage,
        setDeferIncomingFeedPosts,
        flushPendingFeedPosts,
        clearPendingFeedPosts,
        pendingNewPostsCount,
      }}
    >
      {children}
    </PostContext.Provider>
  );
};

export const usePost = () => {
  const context = useContext(PostContext);
  if (!context) {
    throw new Error('usePost must be used within PostProvider');
  }
  return context;
};
