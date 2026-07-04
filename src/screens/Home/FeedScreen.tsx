import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  DeviceEventEmitter,
  Animated,
  Dimensions,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { usePost } from '../../context/PostContext';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { useLiveBroadcast } from '../../context/LiveBroadcastContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from '../../services/api';
import { ENDPOINTS, COLORS, STORY_STRIP_SHOULD_REFRESH, STORAGE_KEYS } from '../../utils/constants';
import { requestCameraAndMicrophone } from '../../utils/mediaPermissions';
import { pruneStaleLiveFeedPosts } from '../../utils/pruneStaleLiveFeedPosts';
import { pauseAllFeedVideos } from '../../utils/feedVideoPlayback';
import { useShowToast } from '../../hooks/useShowToast';
import Svg, { Path } from 'react-native-svg';
import Post from '../../components/Post';
import LivePostCard from '../../components/LivePostCard';
import ChannelsModal from '../../components/ChannelsModal';
import ActivityModal from '../../components/ActivityModal';

interface AvailableUser {
  _id: string;
  name: string;
  username: string;
  profilePic?: string;
}

const FeedScreen = ({ navigation }: any) => {
  const {
    posts,
    setPosts,
    appendPosts,
    filterPostsForFeed,
    unhideFeedPostFromFeed,
    unhideFeedSourceFromFeed,
    setViewerSortBoost,
    deletePost,
    addPost,
    setDeferIncomingFeedPosts,
    flushPendingFeedPosts,
    clearPendingFeedPosts,
    pendingNewPostsCount,
  } = usePost();
  const { user, logout } = useUser();
  const { socket, isUserOnline, notificationCount, refreshNotificationCount } = useSocket();
  const { isLive } = useLiveBroadcast();
  const { t, isRTL } = useLanguage();
  const { theme, toggleTheme, colors } = useTheme();
  const showToast = useShowToast();

  const myUserId = user?._id != null ? String(user._id) : '';

  /** Host browsing the app while live — never show your own LIVE card (avoids opening viewer by mistake). */
  const isOwnLivePost = useCallback(
    (item: any) => {
      if (!myUserId || !item?.isLive) return false;
      const authorId = item.postedBy?._id != null ? String(item.postedBy._id) : '';
      const postId = item._id != null ? String(item._id) : '';
      return authorId === myUserId || postId === `live_${myUserId}`;
    },
    [myUserId],
  );

  const visiblePosts = useMemo(() => {
    if (!isLive) return posts;
    return posts.filter((p) => !isOwnLivePost(p));
  }, [posts, isLive, isOwnLivePost]);

  const hasLiveFeedCards = useMemo(
    () => visiblePosts.some((p: any) => p?.isLive),
    [visiblePosts],
  );

  const postsRef = useRef(posts);
  postsRef.current = posts;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showChessModal, setShowChessModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [busyChessUserIds, setBusyChessUserIds] = useState<string[]>([]);
  const [busyCardUserIds, setBusyCardUserIds] = useState<string[]>([]);
  const [showChannelsModal, setShowChannelsModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  const [activeVideoPostId, setActiveVideoPostId] = useState<string | null>(null);
  /** userId -> story ring info for post avatars */
  const [storyByUserId, setStoryByUserId] = useState<
    Record<string, { storyId: string; hasUnviewed: boolean }>
  >({});
  /** Each feed focus: replay gray→red fill on all story rings */
  const [storyRingReplayKey, setStoryRingReplayKey] = useState(0);
  const isFetchingRef = useRef(false);
  const feedCursorRef = useRef<string | null>(null);
  const lastLoadMoreTimeRef = useRef<number>(0);
  const feedSessionUserIdRef = useRef<string | undefined>(undefined);
  const activeVideoPostIdRef = useRef<string | null>(null);
  const pendingVideoSwitchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feedListRef = useRef<FlatList>(null);
  const lastFeedFocusRefreshAtRef = useRef(0);
  const FEED_FOCUS_REFRESH_MIN_MS = 30_000;
  const LOAD_MORE_DEBOUNCE_MS = 600;
  const FEED_PAGE_SIZE = 12;
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 65,
    minimumViewTime: 180,
  }).current;
  const VIDEO_SWITCH_DELAY_MS = 220;
  const VIDEO_CLEAR_DELAY_MS = 420;
  const VIDEO_AUTOPLAY_RESUME_MS = 600;

  const isScreenFocused = useIsFocused();
  const [videoAutoplayReady, setVideoAutoplayReady] = useState(true);
  const videoAutoplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Floating "scroll to top" button + "new posts" pill state. */
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [hasNewPosts, setHasNewPosts] = useState(false);
  const scrollOffsetRef = useRef(0);
  const lastScrollYRef = useRef(0);
  /** Accumulated scroll distance in the current direction; debounces momentum jitter. */
  const scrollDirAccumRef = useRef(0);
  /** True once we're scrolled past the 3rd post (set by viewability). Gates the button. */
  const pastThresholdRef = useRef(false);
  const prevTopIdRef = useRef<string | null>(null);
  const knownPostIdsRef = useRef<Set<string>>(new Set());
  const scrollTopBtnAnim = useRef(new Animated.Value(0)).current;
  const NEW_POSTS_MIN_OFFSET = 300;
  const deferIncomingRef = useRef(false);

  const scrollFeedToTop = useCallback(() => {
    flushPendingFeedPosts();
    const list = feedListRef.current;
    if (list) {
      const y = scrollOffsetRef.current;
      const winH = Dimensions.get('window').height;
      list.scrollToOffset({ offset: 0, animated: y <= winH * 2.5 });
    }
    setShowScrollTop(false);
    setHasNewPosts(false);
    scrollOffsetRef.current = 0;
    deferIncomingRef.current = false;
    setDeferIncomingFeedPosts(false);
  }, [flushPendingFeedPosts, setDeferIncomingFeedPosts]);

  const handleFeedScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;
      scrollOffsetRef.current = y;

      const shouldDefer = y > NEW_POSTS_MIN_OFFSET;
      if (shouldDefer !== deferIncomingRef.current) {
        deferIncomingRef.current = shouldDefer;
        setDeferIncomingFeedPosts(shouldDefer);
      }

      // Accumulate distance in the current direction so a single jittery frame
      // (momentum wobble) can't toggle the button. Reset the accumulator whenever
      // the direction flips.
      const accum = scrollDirAccumRef.current;
      scrollDirAccumRef.current = Math.sign(dy) === Math.sign(accum) ? accum + dy : dy;

      // Twitter style: hide after a real upward drag; show while scrolling down
      // once we're past the 3rd post. ~14px sustained movement is needed to flip.
      if (scrollDirAccumRef.current < -14) {
        setShowScrollTop((prev) => (prev ? false : prev));
      } else if (scrollDirAccumRef.current > 14 && pastThresholdRef.current) {
        setShowScrollTop((prev) => (prev ? prev : true));
      }

      if (y < 40) {
        if (pendingNewPostsCount > 0) flushPendingFeedPosts();
        setHasNewPosts(false);
        if (deferIncomingRef.current) {
          deferIncomingRef.current = false;
          setDeferIncomingFeedPosts(false);
        }
      }
    },
    [pendingNewPostsCount, flushPendingFeedPosts, setDeferIncomingFeedPosts],
  );

  // Show "New posts" when posts are queued while scrolled down (no list mutation = no jump).
  useEffect(() => {
    if (pendingNewPostsCount > 0 && scrollOffsetRef.current > NEW_POSTS_MIN_OFFSET) {
      setHasNewPosts(true);
    } else if (pendingNewPostsCount === 0) {
      setHasNewPosts(false);
    }
  }, [pendingNewPostsCount]);

  // Track known ids for other feed logic (e.g. focus refresh).
  useEffect(() => {
    const list = visiblePosts;
    const currentTopId = list[0]?._id != null ? String(list[0]._id) : null;
    prevTopIdRef.current = currentTopId;
    knownPostIdsRef.current = new Set(list.map((p: any) => String(p._id)));
  }, [visiblePosts]);

  // Fade the floating button in/out.
  useEffect(() => {
    const visible = showScrollTop || hasNewPosts;
    Animated.timing(scrollTopBtnAnim, {
      toValue: visible ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showScrollTop, hasNewPosts, scrollTopBtnAnim]);

  useEffect(() => {
    feedSessionUserIdRef.current = user?._id;
  }, [user?._id]);

  useEffect(() => {
    const unsub = navigation.addListener('scrollToTop', () => {
      scrollFeedToTop();
    });
    return unsub;
  }, [navigation, scrollFeedToTop]);

  useEffect(() => {
    activeVideoPostIdRef.current = activeVideoPostId;
  }, [activeVideoPostId]);

  useEffect(() => {
    return () => {
      if (pendingVideoSwitchTimerRef.current) {
        clearTimeout(pendingVideoSwitchTimerRef.current);
        pendingVideoSwitchTimerRef.current = null;
      }
    };
  }, []);

  // Refetch feed when screen comes into focus (e.g., navigating back from another screen)
  const fetchStoryStrip = useCallback(async () => {
    if (!user?._id) return;
    try {
      const data = await apiService.get(ENDPOINTS.STORY_FEED_STRIP);
      const m: Record<string, { storyId: string; hasUnviewed: boolean }> = {};
      for (const s of data.stories || []) {
        const uid = s.user?._id?.toString?.();
        if (uid && s.storyId) {
          m[uid] = { storyId: String(s.storyId), hasUnviewed: !!s.hasUnviewed };
        }
      }
      setStoryByUserId(m);
    } catch (_) {
      /* optional feature */
    }
  }, [user?._id]);

  useFocusEffect(
    useCallback(() => {
      // Kill any in-flight WebView audio immediately (create post cancel, profile, etc.).
      pauseAllFeedVideos();
      setActiveVideoPostId(null);
      activeVideoPostIdRef.current = null;
      setVideoAutoplayReady(false);
      if (videoAutoplayTimerRef.current) {
        clearTimeout(videoAutoplayTimerRef.current);
        videoAutoplayTimerRef.current = null;
      }
      videoAutoplayTimerRef.current = setTimeout(() => {
        setVideoAutoplayReady(true);
        videoAutoplayTimerRef.current = null;
      }, VIDEO_AUTOPLAY_RESUME_MS);

      setStoryRingReplayKey((k) => k + 1);
      refreshNotificationCount?.();
      fetchStoryStrip();

      const now = Date.now();
      const feedStale = now - lastFeedFocusRefreshAtRef.current >= FEED_FOCUS_REFRESH_MIN_MS;
      if (feedStale && !isFetchingRef.current) {
        lastFeedFocusRefreshAtRef.current = now;
        fetchFeed();
      }

      return () => {
        pauseAllFeedVideos();
        if (videoAutoplayTimerRef.current) {
          clearTimeout(videoAutoplayTimerRef.current);
          videoAutoplayTimerRef.current = null;
        }
        if (pendingVideoSwitchTimerRef.current) {
          clearTimeout(pendingVideoSwitchTimerRef.current);
          pendingVideoSwitchTimerRef.current = null;
        }
        setActiveVideoPostId(null);
        activeVideoPostIdRef.current = null;
        setVideoAutoplayReady(false);
      };
      // fetchFeed intentionally omitted — use refs above to avoid focus-loop on loading/state changes
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchStoryStrip, refreshNotificationCount])
  );

  useEffect(() => {
    fetchFeed();
  }, []);

  /** First visit to home after login: ask camera + mic so calls/live do not block on permission dialogs. */
  useEffect(() => {
    if (!user?._id) return;
    let cancelled = false;
    (async () => {
      try {
        const key = `${STORAGE_KEYS.MEDIA_PERMISSIONS_PROMPTED_PREFIX}${String(user._id)}`;
        const done = await AsyncStorage.getItem(key);
        if (done === '1' || cancelled) return;
        await requestCameraAndMicrophone();
        await AsyncStorage.setItem(key, '1');
      } catch {
        /* non-fatal */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?._id]);

  useEffect(() => {
    fetchStoryStrip();
  }, [fetchStoryStrip]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(STORY_STRIP_SHOULD_REFRESH, () => {
      setStoryRingReplayKey((k) => k + 1);
      fetchStoryStrip();
    });
    return () => sub.remove();
  }, [fetchStoryStrip]);

  // Socket listeners specific to FeedScreen UI
  // NOTE: post create/update/delete events are handled globally in SocketContext/PostContext
  useEffect(() => {
    if (!socket) return;

    const handleChessDeclined = (data: any) => {
      // Backend sends: { from } where 'from' is the user who declined (the opponent)
      console.log('♟️ [FeedScreen] Challenge declined by:', data.from);
      showToast('Challenge Declined', 'Your challenge was declined', 'info');
      // Remove the declined user from busy list so they appear available again
      if (data.from) {
        setBusyChessUserIds(prev => prev.filter(id => id?.toString() !== data.from?.toString()));
      }
    };

    const handleCardDeclined = (data: any) => {
      console.log('🃏 [FeedScreen] Card challenge declined by:', data.from);
      showToast('Challenge Declined', 'Your challenge was declined', 'info');
      if (data.from) {
        setBusyCardUserIds(prev => prev.filter(id => id?.toString() !== data.from?.toString()));
      }
    };

    const handleUserAvailableCard = (data: any) => {
      console.log('🃏 [FeedScreen] User available for card game:', data.userId);
      if (data.userId) {
        setBusyCardUserIds(prev => prev.filter(id => id?.toString() !== data.userId?.toString()));
        // Refresh available users list
        fetchAvailableUsers();
      }
    };

    const normalizeStreamerId = (raw: unknown) => {
      if (raw == null) return '';
      return String(
        typeof raw === 'object' && raw !== null && 'toString' in (raw as object)
          ? (raw as { toString: () => string }).toString()
          : raw,
      ).trim();
    };

    const removeLiveCard = (sid: string) => {
      deletePost(`live_${sid}`);
      setPosts((prev: any[]) =>
        prev.filter((p: any) => {
          const pid = p?._id != null ? String(p._id) : '';
          if (pid === `live_${sid}`) return false;
          const authorId = p?.postedBy?._id != null ? String(p.postedBy._id) : '';
          return !(p?.isLive && authorId === sid);
        }),
      );
    };

    // Live stream: inject card at top when a followed user goes live
    const handleStreamStarted = (data: any) => {
      const sid = normalizeStreamerId(data?.streamerId);
      if (!sid) return;
      const myId = user?._id != null ? String(user._id) : '';
      // Host is already broadcasting — don't inject a LIVE card they could tap by mistake.
      if (myId && sid === myId) return;
      const pseudo = {
        _id:          `live_${sid}`,
        isLive:       true,
        liveStreamId: sid,
        roomName:     data.roomName,
        postedBy:     { _id: sid, name: data.streamerName, profilePic: data.streamerProfilePic },
        createdAt:    new Date().toISOString(),
        updatedAt:    new Date().toISOString(),
        replies:      [],
        likes:        [],
      };
      addPost(pseudo as any);
    };

    const handleStreamEnded = (payload: any) => {
      const sid = normalizeStreamerId(payload?.streamerId);
      if (!sid) return;
      removeLiveCard(sid);
    };

    // Incoming chess/card challenges: SocketContext + AppNavigator overlays (ChessChallengeNotification / CardChallengeNotification).
    // Do not duplicate listeners here — caused a second full-screen modal on Feed.

    socket.on('chessDeclined', handleChessDeclined);
    socket.on('cardDeclined', handleCardDeclined);
    socket.on('userAvailableCard', handleUserAvailableCard);
    socket.on('livekit:streamStarted', handleStreamStarted);
    socket.on('livekit:streamEnded', handleStreamEnded);

    return () => {
      socket.off('chessDeclined', handleChessDeclined);
      socket.off('cardDeclined', handleCardDeclined);
      socket.off('userAvailableCard', handleUserAvailableCard);
      socket.off('livekit:streamStarted', handleStreamStarted);
      socket.off('livekit:streamEnded', handleStreamEnded);
    };
  }, [socket, user, navigation, deletePost, setPosts, addPost]);

  // Backup: same server status check as pull-to-refresh (~15s, matches backend disconnect grace).
  useEffect(() => {
    if (!hasLiveFeedCards) return;

    const syncEndedLiveCards = async () => {
      const prev = postsRef.current;
      if (!prev.some((p: any) => p?.isLive)) return;
      const pruned = await pruneStaleLiveFeedPosts(prev);
      if (pruned.length !== prev.length) {
        setPosts(filterPostsForFeed(pruned));
      }
    };

    const initial = setTimeout(syncEndedLiveCards, 3000);
    const timer = setInterval(syncEndedLiveCards, 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [hasLiveFeedCards, filterPostsForFeed, setPosts]);

  const fetchFeed = async (loadMore = false) => {
    // Prevent duplicate requests
    if (isFetchingRef.current) {
      console.log('⏭️ [FeedScreen] fetchFeed: Skipping (already fetching)');
      return;
    }

    if (loadMore && (!hasMore || loadingMore)) {
      console.log('⏭️ [FeedScreen] fetchFeed: Skipping loadMore (no more posts or already loading)');
      return;
    }

    // Load more with 0 posts causes infinite loop (onEndReached fires on empty list)
    if (loadMore && posts.length === 0) {
      console.log('⏭️ [FeedScreen] fetchFeed: Skipping loadMore (no posts yet, use refresh instead)');
      return;
    }

    isFetchingRef.current = true;

    try {
      const limit = FEED_PAGE_SIZE;
      let url = `${ENDPOINTS.GET_FEED}?limit=${limit}`;
      if (loadMore) {
        const token = feedCursorRef.current;
        if (!token) {
          isFetchingRef.current = false;
          setLoadingMore(false);
          return;
        }
        if (token.startsWith('skip:')) {
          url += `&skip=${encodeURIComponent(token.slice(5))}`;
        } else {
          url += `&cursor=${encodeURIComponent(token)}`;
        }
      } else {
        feedCursorRef.current = null;
      }

      console.log(`📥 [FeedScreen] Fetching feed: loadMore=${loadMore}, limit=${limit}`);

      const data = await apiService.get(url);
      const postsArray = Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []);
      const responseHasMore = data.hasMore !== undefined ? data.hasMore : postsArray.length === limit;

      if (data.nextCursor != null && String(data.nextCursor).trim() !== '') {
        feedCursorRef.current = String(data.nextCursor);
      } else if (responseHasMore && typeof data.nextSkip === 'number') {
        feedCursorRef.current = `skip:${data.nextSkip}`;
      } else {
        feedCursorRef.current = null;
      }
      
      // Filter out duplicates by _id
      const uniquePosts = postsArray.filter((post: any, index: number, self: any[]) => {
        const postId = post._id?.toString?.() ?? String(post._id);
        return postId && self.findIndex((p: any) => {
          const pId = p._id?.toString?.() ?? String(p._id);
          return pId === postId;
        }) === index;
      });

      const prunedPosts = loadMore ? uniquePosts : await pruneStaleLiveFeedPosts(uniquePosts);

      if (loadMore) {
        // Append without re-sorting existing rows (pagination)
        appendPosts(prunedPosts);
        setLoadingMore(false);
      } else {
        // Replace all posts (initial load or refresh)
        setPosts(filterPostsForFeed(prunedPosts));
        setLoading(false);
        setRefreshing(false);
      }
      
      setHasMore(responseHasMore);
      console.log(`✅ [FeedScreen] Fetched ${uniquePosts.length} unique posts (hasMore=${responseHasMore})`);
    } catch (error: any) {
      console.error('❌ Error fetching feed:', error);
      if (!loadMore) {
        showToast('Error', error.message || 'Failed to load feed', 'error');
        setLoading(false);
        setRefreshing(false);
      } else {
        setLoadingMore(false);
      }
    } finally {
      isFetchingRef.current = false;
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    setHasMore(true);
    feedCursorRef.current = null;
    setStoryRingReplayKey((k) => k + 1);
    setHasNewPosts(false);
    clearPendingFeedPosts();
    deferIncomingRef.current = false;
    setDeferIncomingFeedPosts(false);
    scrollOffsetRef.current = 0;
    feedListRef.current?.scrollToOffset?.({ offset: 0, animated: true });
    fetchStoryStrip();
    fetchFeed(false); // Reset and fetch from beginning
  };

  const handleLoadMore = () => {
    if (posts.length === 0) return;
    if (!hasMore || loadingMore || isFetchingRef.current) return;

    const now = Date.now();
    if (now - lastLoadMoreTimeRef.current < LOAD_MORE_DEBOUNCE_MS) return;

    lastLoadMoreTimeRef.current = now;
    setLoadingMore(true);
    fetchFeed(true);
  };

  const fetchAvailableUsers = async () => {
    if (!user) return;

    setLoadingUsers(true);
    try {
      // Busy users — use local arrays for filtering (state updates are async and would be stale here)
      let chessBusy: string[] = [];
      let cardBusy: string[] = [];
      try {
        const busyRes = await apiService.get('/api/user/busyChessUsers');
        chessBusy = (busyRes?.busyUserIds || []).map((x: any) => x?.toString()).filter(Boolean);
        setBusyChessUserIds(chessBusy);
      } catch {
        setBusyChessUserIds([]);
      }
      try {
        const busyCardRes = await apiService.get('/api/user/busyCardUsers');
        cardBusy = (busyCardRes?.busyUserIds || []).map((x: any) => x?.toString()).filter(Boolean);
        setBusyCardUserIds(cardBusy);
      } catch {
        setBusyCardUserIds([]);
      }

      /**
       * getUserPro no longer returns following/followers id lists (scalable profile API).
       * Use dedicated endpoints — same data the Follow lists use (up to 500 each, full user objects).
       */
      const [followingRaw, followersRaw] = await Promise.all([
        apiService.get(ENDPOINTS.GET_FOLLOWING).catch(() => []),
        apiService.get(ENDPOINTS.GET_FOLLOWERS_USERS).catch(() => []),
      ]);

      const normalizeList = (data: any): any[] => {
        if (Array.isArray(data)) return data;
        if (data && Array.isArray(data.users)) return data.users;
        return [];
      };

      const followingList = normalizeList(followingRaw);
      const followersList = normalizeList(followersRaw);

      const byId = new Map<string, AvailableUser>();
      for (const u of [...followingList, ...followersList]) {
        if (!u?._id) continue;
        const id = u._id.toString();
        if (!byId.has(id)) {
          byId.set(id, {
            _id: id,
            name: u.name ?? '',
            username: u.username ?? '',
            profilePic: u.profilePic,
          });
        }
      }

      const allUsers = Array.from(byId.values());
      const currentUserIdStr = user._id?.toString();

      const onlineAvailableUsers = allUsers.filter((u) => {
        const userIdStr = u._id?.toString();
        if (!userIdStr || !currentUserIdStr) return false;
        if (userIdStr === currentUserIdStr) return false;
        if (!isUserOnline(userIdStr)) return false;
        if (chessBusy.some((b) => b === userIdStr)) return false;
        if (cardBusy.some((b) => b === userIdStr)) return false;
        return true;
      });

      setAvailableUsers(onlineAvailableUsers);
    } catch (error) {
      console.error('Error fetching available users:', error);
      showToast('Error', 'Failed to fetch users', 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleOpenChessModal = () => {
    setShowChessModal(true);
    fetchAvailableUsers();
  };

  const handleOpenCardModal = () => {
    setShowCardModal(true);
    fetchAvailableUsers();
  };

  const handleSendChallenge = (opponent: AvailableUser) => {
    if (!socket?.isSocketConnected?.()) {
      showToast('Error', 'Not connected — wait a moment and try again', 'error');
      return;
    }

    socket.emit('chessChallenge', {
      from: user?._id,
      to: opponent._id,
      fromName: user?.name,
      fromUsername: user?.username,
      fromProfilePic: user?.profilePic || '',
    });

    showToast('Success', `Challenge sent to ${opponent.name}!`, 'success');
    setShowChessModal(false);
  };

  const handleSendCardChallenge = (opponent: AvailableUser) => {
    if (!socket?.isSocketConnected?.()) {
      showToast('Error', 'Not connected — wait a moment and try again', 'error');
      return;
    }

    socket.emit('cardChallenge', {
      from: user?._id,
      to: opponent._id,
      fromName: user?.name,
      fromUsername: user?.username,
      fromProfilePic: user?.profilePic || '',
    });

    showToast('Success', `Challenge sent to ${opponent.name}!`, 'success');
    setShowCardModal(false);
  };

  const handleLogout = async () => {
    try {
      // Use the single source of truth logout (clears @user and tells backend to clear cookie)
      await logout();
      showToast(t('loggedOut'), t('youHaveBeenLoggedOut'), 'success');
    } catch (error) {
      console.error('❌ Error logging out:', error);
      showToast(t('error'), t('failedToLogout'), 'error');
    }
  };

  const renderPost = ({ item }: { item: any }) => {
    // Live stream pseudo-post — show dedicated live card
    if (item.isLive) return <LivePostCard post={item} />;

    const uid = item.postedBy?._id?.toString?.() ?? '';
    const ring = uid ? storyByUserId[uid] : undefined;
    const postId = item?._id?.toString?.() ?? String(item?._id ?? '');
    return (
      <Post
        post={item}
        feedWideCard
        storyRing={ring}
        storyRingReplayKey={storyRingReplayKey}
        screenFocused={isScreenFocused}
        autoPlayMedia={
          !!postId && activeVideoPostId === postId && videoAutoplayReady && isScreenFocused
        }
      />
    );
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item: any; isViewable?: boolean; index?: number | null }> }) => {
    const visibleVideos = viewableItems.filter((entry) => {
      if (!entry?.isViewable) return false;
      const p = entry?.item;
      const img = String(p?.img || '');
      const isVideo =
        !!img &&
        (/\.(mp4|webm|ogg|mov)$/i.test(img) || img.includes('/video/upload/'));
      const isYouTube = /youtube\.com|youtu\.be|ytimg\.com|img\.youtube\.com/i.test(img);
      return isVideo && !isYouTube;
    });

    // Prefer the lower/next visible video so scrolling down activates the post in focus.
    const preferred = visibleVideos.length > 0 ? visibleVideos[visibleVideos.length - 1] : null;
    const nextId = preferred?.item?._id?.toString?.() ?? null;
    const currentId = activeVideoPostIdRef.current;
    if (currentId === nextId) return;

    if (pendingVideoSwitchTimerRef.current) {
      clearTimeout(pendingVideoSwitchTimerRef.current);
      pendingVideoSwitchTimerRef.current = null;
    }

    const delayMs = nextId ? VIDEO_SWITCH_DELAY_MS : VIDEO_CLEAR_DELAY_MS;
    pendingVideoSwitchTimerRef.current = setTimeout(() => {
      // Apply only the latest stable candidate to avoid rapid toggling jitter.
      setActiveVideoPostId(nextId);
      activeVideoPostIdRef.current = nextId;
      pendingVideoSwitchTimerRef.current = null;
    }, delayMs);
  }).current;

  // Dedicated viewability for the button: fires instantly (0% / 0ms) so it isn't delayed by the
  // video config. Show once the 4th post (index 3) is the topmost visible; hysteresis avoids flicker.
  const onButtonViewable = useRef(
    ({ viewableItems }: { viewableItems: Array<{ isViewable?: boolean; index?: number | null }> }) => {
      const idxs = viewableItems
        .filter((v) => v?.isViewable && typeof v.index === 'number')
        .map((v) => v.index as number);
      if (idxs.length === 0) return;
      const firstVisible = Math.min(...idxs);
      if (firstVisible >= 3) {
        // Eligible to appear — actual show happens on downward scroll (Twitter style).
        pastThresholdRef.current = true;
      } else if (firstVisible <= 1) {
        pastThresholdRef.current = false;
        setShowScrollTop((prev) => (prev ? false : prev));
      }
    },
  ).current;

  const viewabilityPairs = useRef([
    { viewabilityConfig, onViewableItemsChanged },
    {
      viewabilityConfig: { itemVisiblePercentThreshold: 0, minimumViewTime: 0 },
      onViewableItemsChanged: onButtonViewable,
    },
  ]).current;

  const quickActionsHeader = (
    <View style={styles.quickAccessHeaderContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickAccessScrollContent}
      >
        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() =>
            navigation.navigate('Notifications', { screen: 'NotificationsMain' })
          }
        >
          <View style={styles.notificationIconContainer}>
            <Text style={styles.quickAccessIcon}>🔔</Text>
            {notificationCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </View>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Alerts</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={handleOpenChessModal}
        >
          <Text style={styles.quickAccessIcon}>♟️</Text>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Chess</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={handleOpenCardModal}
        >
          <Text style={styles.quickAccessIcon}>🃏</Text>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Cards</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() => navigation.navigate('Weather')}
        >
          <Text style={styles.quickAccessIcon}>🌤️</Text>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Weather</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() => navigation.navigate('Football')}
        >
          <Text style={styles.quickAccessIcon}>⚽</Text>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Football</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() => setShowChannelsModal(true)}
        >
          <Text style={styles.quickAccessIcon}>📺</Text>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Channels</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() => setShowActivityModal(true)}
        >
          <Text style={styles.quickAccessIcon}>🔴</Text>
          <Text style={[styles.quickAccessLabel, { color: colors.cardText }]}>Activity</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }, isRTL && styles.headerTitleRTL]}>{t('feed')}</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity
            style={styles.logoutButton}
            onPress={handleLogout}
            activeOpacity={0.85}
          >
            <View style={styles.logoutButtonInner}>
              <Text style={styles.logoutButtonText}>↩</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
            onPress={handleRefresh}
            disabled={refreshing}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={t('refreshFeed') || 'Refresh feed'}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.refreshIcon, { color: colors.primary }]}>↻</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.themeButton}
            onPress={toggleTheme}
            activeOpacity={0.85}
          >
            <Text style={styles.themeButtonText}>
              {theme === 'dark' ? '☀️' : '🌙'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.createButton, { backgroundColor: colors.primary }]}
            onPress={() => navigation.navigate('CreatePost')}
          >
            <Text style={[styles.createButtonText, { color: colors.buttonText }]}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        ref={feedListRef}
        data={loading ? [] : visiblePosts}
        renderItem={renderPost}
        removeClippedSubviews={false}
        ItemSeparatorComponent={() => <View style={styles.postSeparator} />}
        keyExtractor={(item, index) => {
          // Ensure unique keys by using both _id and index as fallback
          const id = item._id?.toString?.() ?? String(item._id);
          return id || `post-${index}`;
        }}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.35}
        onScroll={handleFeedScroll}
        scrollEventThrottle={16}
        maintainVisibleContentPosition={{
          minIndexForVisible: 0,
          autoscrollToTopThreshold: 10,
        }}
        viewabilityConfigCallbackPairs={viewabilityPairs}
        ListHeaderComponent={
          <View>
            {quickActionsHeader}
            {loading ? (
              <View style={styles.inlineLoading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            ) : null}
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No posts yet</Text>
              <Text style={styles.emptySubtext}>Follow users to see their posts</Text>
            </View>
          ) : null
        }
      />

      {/* Floating scroll-to-top / new posts button (always mounted; visibility is animated) */}
      {(
        <Animated.View
          pointerEvents={showScrollTop || hasNewPosts ? 'box-none' : 'none'}
          style={[
            styles.scrollTopWrap,
            {
              opacity: scrollTopBtnAnim,
              transform: [
                {
                  translateY: scrollTopBtnAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
                {
                  scale: scrollTopBtnAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.8, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={scrollFeedToTop}
            accessibilityRole="button"
            accessibilityLabel={hasNewPosts ? 'See new posts' : 'Scroll to top'}
            style={[
              hasNewPosts ? styles.newPostsPill : styles.scrollTopButton,
              { backgroundColor: colors.primary },
            ]}
          >
            <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
              <Path
                d="M6 15l6-6 6 6"
                stroke="#FFFFFF"
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            {hasNewPosts && <Text style={styles.newPostsText}>New posts</Text>}
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Channels Modal */}
      <ChannelsModal
        visible={showChannelsModal}
        onClose={() => setShowChannelsModal(false)}
        onChannelFollowed={(postId?: string) => {
          // Unhide ONLY the channel post the user just re-added.
          if (postId) unhideFeedPostFromFeed(postId);
          // Bubble the newly added/re-added channel post to the top for this viewer (survives refresh).
          if (postId) setViewerSortBoost(postId, Date.now());
          fetchFeed(); // Refresh feed when channel is followed
        }}
      />

      {/* Activity Modal */}
      <ActivityModal
        visible={showActivityModal}
        onClose={() => setShowActivityModal(false)}
        onActivityClick={(activity) => {
          // Navigate to post or user profile based on activity
          if (activity.postId?._id) {
            // PostDetail is in the same FeedStack, so direct navigation works
            navigation.navigate('PostDetail', { postId: activity.postId._id });
            setShowActivityModal(false);
          } else if (activity.targetUser?.username) {
            navigation.navigate('UserProfile', { username: activity.targetUser.username });
            setShowActivityModal(false);
          } else if (activity.userId?.username) {
            navigation.navigate('UserProfile', { username: activity.userId.username });
            setShowActivityModal(false);
          }
        }}
      />

      {/* Card Challenge Modal */}
      <Modal
        visible={showCardModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCardModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>🃏 Challenge to Go Fish</Text>
              <TouchableOpacity onPress={() => setShowCardModal(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              {loadingUsers
                ? 'Loading online users...'
                : availableUsers.length > 0
                ? 'Select a user to challenge:'
                : 'No online users available'}
            </Text>

            {loadingUsers ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            ) : availableUsers.length > 0 ? (
              <FlatList
                data={availableUsers}
                keyExtractor={(item) => item._id}
                style={styles.userList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.userItem}
                    onPress={() => handleSendCardChallenge(item)}
                  >
                    <View style={styles.userInfo}>
                      <View style={styles.userAvatar}>
                        <Text style={styles.userAvatarText}>
                          {item.name?.charAt(0).toUpperCase() || '?'}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.userName}>{item.name}</Text>
                        <Text style={styles.userUsername}>@{item.username}</Text>
                      </View>
                    </View>
                    <View style={styles.onlineDot} />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <Text style={styles.emptyText}>
                  No online users to challenge.{'\n'}
                  Follow users to challenge them!
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Chess Challenge Modal */}
      <Modal
        visible={showChessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowChessModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>♟️ Challenge to Chess</Text>
              <TouchableOpacity onPress={() => setShowChessModal(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              {loadingUsers
                ? 'Loading online users...'
                : availableUsers.length > 0
                ? 'Select a user to challenge:'
                : 'No online users available'}
            </Text>

            {loadingUsers ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            ) : availableUsers.length > 0 ? (
              <FlatList
                data={availableUsers}
                keyExtractor={(item, index) => {
                  const id = item._id?.toString?.() ?? String(item._id);
                  return id || `user-${index}`;
                }}
                style={styles.userList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.userItem}
                    onPress={() => handleSendChallenge(item)}
                  >
                    <View style={styles.userInfo}>
                      <View style={styles.userAvatar}>
                        <Text style={styles.userAvatarText}>
                          {item.name?.charAt(0).toUpperCase() || '?'}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.userName}>{item.name}</Text>
                        <Text style={styles.userUsername}>@{item.username}</Text>
                      </View>
                    </View>
                    <View style={styles.onlineDot} />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <Text style={styles.emptyText}>
                  No online users to challenge.{'\n'}
                  Follow users to challenge them!
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  logoutButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#D93543',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#D93543',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 5,
  },
  logoutButtonInner: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 20,
    lineHeight: 20,
    fontWeight: '700',
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlign: 'center',
    marginTop: -4,
  },
  createButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 21,
    fontWeight: 'bold',
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnDisabled: {
    opacity: 0.6,
  },
  refreshIcon: {
    fontSize: 23,
    fontWeight: '700',
  },
  themeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  themeButtonText: {
    fontSize: 18,
    includeFontPadding: false,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  listContainer: {
    paddingBottom: 20,
  },
  postSeparator: {
    height: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  inlineLoading: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollTopWrap: {
    position: 'absolute',
    bottom: 20,
    alignSelf: 'center',
  },
  scrollTopButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
  },
  newPostsPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 6,
  },
  newPostsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  quickAccessHeaderContainer: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    marginBottom: 8,
  },
  quickAccessScrollContent: {
    paddingHorizontal: 10,
    gap: 8,
  },
  quickAccessButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 74,
    borderRadius: 10,
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickAccessIcon: {
    fontSize: 22, // reduced from 28
    marginBottom: 3, // reduced from 4
  },
  quickAccessLabel: {
    fontSize: 10, // reduced from 11
    color: COLORS.text,
    fontWeight: '600',
  },
  notificationIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.backgroundLight,
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  modalCloseButton: {
    fontSize: 24,
    color: COLORS.textGray,
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textGray,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalLoading: {
    padding: 40,
    alignItems: 'center',
  },
  modalEmpty: {
    padding: 40,
    alignItems: 'center',
  },
  userList: {
    maxHeight: 300,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  userUsername: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
  },
});

export default FeedScreen;
