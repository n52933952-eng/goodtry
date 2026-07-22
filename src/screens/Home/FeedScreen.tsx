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
  NativeSyntheticEvent,
  NativeScrollEvent,
  Platform,
  Vibration,
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
import { pauseAllFeedVideos, emitFeedVisiblePostIds, isFeedAutoPlayMediaPost, FEED_REQUEST_MEDIA_AUTOPLAY } from '../../utils/feedVideoPlayback';
import { useShowToast } from '../../hooks/useShowToast';
import { useCollapsingHeader } from '../../hooks/useCollapsingHeader';
import { useTabBarCollapseOnFocus } from '../../context/TabBarCollapseContext';
import Svg, { Path } from 'react-native-svg';
import Post from '../../components/Post';
import LivePostCard from '../../components/LivePostCard';
import FeedNativeAd, { FEED_AD_EVERY } from '../../components/ads/FeedNativeAd';
import ChannelsModal from '../../components/ChannelsModal';
import ActivityModal from '../../components/ActivityModal';
import {
  createOpponentPagerState,
  fetchNextOnlineOpponentBatch,
  GAME_OPPONENT_PAGE_SIZE,
  GAME_OPPONENT_SCAN_PAGE_SIZE,
  type GameOpponentUser,
  type OpponentPagerState,
} from '../../utils/fetchOnlineGameOpponents';

type AvailableUser = GameOpponentUser;

/** Survives FeedScreen remounts (`detachInactiveScreens`) so tab switches don't refetch every time. */
let lastFeedRefreshAtMs = 0;
const FEED_FOCUS_REFRESH_MIN_MS = 30_000;
/** After jump-to-top: land this many px above 0, then ease in (IG-style, not full-feed scroll). */
const TOP_LAND_PREVIEW_PX = 56;

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
  const { socket, isUserOnline, notificationCount, refreshNotificationCount, setPresenceWatchUserIds, refreshPresenceSubscription } = useSocket();
  const { isLive } = useLiveBroadcast();
  const { t } = useLanguage();
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

  /** Feed rows = posts + AdMob native ads every FEED_AD_EVERY posts. */
  const feedRows = useMemo(() => {
    const rows: Array<{ kind: 'post'; post: any } | { kind: 'ad'; key: string }> = [];
    visiblePosts.forEach((post: any, index: number) => {
      rows.push({ kind: 'post', post });
      if ((index + 1) % FEED_AD_EVERY === 0) {
        rows.push({ kind: 'ad', key: `ad-${index}` });
      }
    });
    return rows;
  }, [visiblePosts]);

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
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);
  const [hasMoreOpponents, setHasMoreOpponents] = useState(false);
  const opponentPagerRef = useRef<OpponentPagerState>(createOpponentPagerState());
  const opponentShownIdsRef = useRef<Set<string>>(new Set());
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
  const newPostsAppearAnim = useRef(new Animated.Value(0)).current;
  const newPostsPulseAnim = useRef(new Animated.Value(1)).current;
  /** Soft settle bounce after teleport-to-top (does not scroll through posts). */
  const feedLandAnim = useRef(new Animated.Value(0)).current;
  const NEW_POSTS_MIN_OFFSET = 300;
  const deferIncomingRef = useRef(false);

  const {
    headerTranslateStyle,
    mergeOnScroll,
    resetHeader,
    measuredHeight: feedHeaderHeight,
    setMeasuredHeight: setFeedHeaderHeight,
  } = useCollapsingHeader();
  const { mergeTabBarScroll, resetTabBar, tabBarHeight } = useTabBarCollapseOnFocus('feed');

  /** Feed stack has no UserProfile — open via Profile tab (same as Post.tsx). */
  const navigateToUserProfile = useCallback(
    (usernameOrId: string) => {
      const query = String(usernameOrId || '').trim();
      if (!query) return;
      const params = { username: query };

      const tryPush = (nav: any): boolean => {
        if (!nav) return false;
        try {
          const names = (nav.getState?.() as { routeNames?: string[] } | undefined)?.routeNames ?? [];
          if (names.includes('UserProfile')) {
            if (typeof nav.push === 'function') nav.push('UserProfile', params);
            else nav.navigate('UserProfile', params);
            return true;
          }
        } catch {
          /* ignore */
        }
        return false;
      };

      if (tryPush(navigation)) return;
      if (tryPush(navigation.getParent?.())) return;

      const tabNav = navigation.getParent?.();
      if (tabNav?.navigate) {
        tabNav.navigate('Profile', { screen: 'UserProfile', params });
        return;
      }
      navigation.navigate('Profile', { screen: 'UserProfile', params });
    },
    [navigation],
  );

  const scrollFeedToTop = useCallback(() => {
    const list = feedListRef.current;
    const flushingNewPosts = pendingNewPostsCount > 0 || hasNewPosts;

    // Light tap — same class of feedback IG/FB use on scroll-to-top.
    try {
      Vibration.vibrate(Platform.OS === 'android' ? 12 : 10);
    } catch {
      /* ignore */
    }

    pastThresholdRef.current = false;
    scrollDirAccumRef.current = 0;
    deferIncomingRef.current = false;
    setDeferIncomingFeedPosts(false);
    setShowScrollTop(false);
    setHasNewPosts(false);
    resetHeader();
    resetTabBar();

    const playLandBounce = () => {
      feedLandAnim.setValue(10);
      Animated.spring(feedLandAnim, {
        toValue: 0,
        friction: 7,
        tension: 110,
        useNativeDriver: true,
      }).start();
    };

    if (flushingNewPosts) {
      // New posts + MVC: pin at 0 instantly, then soft land bounce only.
      if (list) list.scrollToOffset({ offset: 0, animated: false });
      scrollOffsetRef.current = 0;
      lastScrollYRef.current = 0;
      flushPendingFeedPosts();
      requestAnimationFrame(() => {
        list?.scrollToOffset({ offset: 0, animated: false });
        playLandBounce();
      });
      return;
    }

    // Arrow: teleport near top (never through hundreds of posts), then short settle.
    if (list) {
      list.scrollToOffset({ offset: TOP_LAND_PREVIEW_PX, animated: false });
    }
    scrollOffsetRef.current = TOP_LAND_PREVIEW_PX;
    lastScrollYRef.current = TOP_LAND_PREVIEW_PX;
    flushPendingFeedPosts();

    requestAnimationFrame(() => {
      list?.scrollToOffset({ offset: 0, animated: true });
      playLandBounce();
      scrollOffsetRef.current = 0;
      lastScrollYRef.current = 0;
    });
  }, [
    flushPendingFeedPosts,
    setDeferIncomingFeedPosts,
    resetHeader,
    resetTabBar,
    pendingNewPostsCount,
    hasNewPosts,
    feedLandAnim,
  ]);

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

      // Near top: never show the arrow (avoids flash on bounce / reach-top).
      if (y < 40) {
        pastThresholdRef.current = false;
        scrollDirAccumRef.current = 0;
        setShowScrollTop((prev) => (prev ? false : prev));
        if (pendingNewPostsCount > 0) flushPendingFeedPosts();
        setHasNewPosts(false);
        if (deferIncomingRef.current) {
          deferIncomingRef.current = false;
          setDeferIncomingFeedPosts(false);
        }
        return;
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

  // Bottom arrow: only when scrolled down and not showing the new-posts pill.
  useEffect(() => {
    const visible = showScrollTop && !hasNewPosts;
    Animated.spring(scrollTopBtnAnim, {
      toValue: visible ? 1 : 0,
      friction: 8,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [showScrollTop, hasNewPosts, scrollTopBtnAnim]);

  // New-posts pill: IG-style appear + soft breathe while waiting.
  useEffect(() => {
    if (!hasNewPosts) {
      Animated.timing(newPostsAppearAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
      newPostsPulseAnim.stopAnimation();
      newPostsPulseAnim.setValue(1);
      return;
    }

    try {
      Vibration.vibrate(Platform.OS === 'android' ? 10 : 8);
    } catch {
      /* ignore */
    }

    Animated.spring(newPostsAppearAnim, {
      toValue: 1,
      friction: 7,
      tension: 120,
      useNativeDriver: true,
    }).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(newPostsPulseAnim, {
          toValue: 1.04,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(newPostsPulseAnim, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    pulse.start();
    return () => {
      pulse.stop();
      newPostsPulseAnim.setValue(1);
    };
  }, [hasNewPosts, newPostsAppearAnim, newPostsPulseAnim]);

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
    const sub = DeviceEventEmitter.addListener(
      FEED_REQUEST_MEDIA_AUTOPLAY,
      ({ postId }: { postId?: string }) => {
        const id = postId != null ? String(postId).trim() : '';
        if (!id) return;
        if (pendingVideoSwitchTimerRef.current) {
          clearTimeout(pendingVideoSwitchTimerRef.current);
          pendingVideoSwitchTimerRef.current = null;
        }
        setActiveVideoPostId(id);
        activeVideoPostIdRef.current = id;
        setVideoAutoplayReady(true);
      },
    );
    return () => sub.remove();
  }, []);

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

      // Only refetch when empty or older than FEED_FOCUS_REFRESH_MIN_MS (module-level timer).
      const now = Date.now();
      const hasPosts = postsRef.current.length > 0;
      const feedStale = now - lastFeedRefreshAtMs >= FEED_FOCUS_REFRESH_MIN_MS;
      if ((!hasPosts || feedStale) && !isFetchingRef.current) {
        lastFeedRefreshAtMs = now;
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
  }, [socket, user, navigation, deletePost, setPosts, addPost, showToast]);

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
      if (!loadMore) {
        lastFeedRefreshAtMs = Date.now();
      }
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

  const fetchAvailableUsers = useCallback(async (mode: 'replace' | 'append' = 'replace') => {
    if (!user?._id) return;
    if (mode === 'append') {
      if (loadingMoreUsers || loadingUsers || opponentPagerRef.current.done) return;
      setLoadingMoreUsers(true);
    } else {
      setLoadingUsers(true);
      opponentPagerRef.current = createOpponentPagerState();
      opponentShownIdsRef.current = new Set();
      setAvailableUsers([]);
      setHasMoreOpponents(false);
    }

    try {
      let chessBusy: string[] = busyChessUserIds;
      let cardBusy: string[] = busyCardUserIds;
      if (mode === 'replace') {
        try {
          const busyRes = await apiService.get('/api/user/busyChessUsers');
          chessBusy = (busyRes?.busyUserIds || []).map((x: any) => x?.toString()).filter(Boolean);
          setBusyChessUserIds(chessBusy);
        } catch {
          chessBusy = [];
          setBusyChessUserIds([]);
        }
        try {
          const busyCardRes = await apiService.get('/api/user/busyCardUsers');
          cardBusy = (busyCardRes?.busyUserIds || []).map((x: any) => x?.toString()).filter(Boolean);
          setBusyCardUserIds(cardBusy);
        } catch {
          cardBusy = [];
          setBusyCardUserIds([]);
        }
        refreshPresenceSubscription?.();
      }

      const watchedPresenceIdsRef = { current: [] as string[] };
      let presencePrimed = false;
      const { users, pager } = await fetchNextOnlineOpponentBatch({
        currentUserId: String(user._id),
        isUserOnline,
        busyUserIds: [...chessBusy, ...cardBusy],
        pager: opponentPagerRef.current,
        alreadyShownIds: opponentShownIdsRef.current,
        targetCount: GAME_OPPONENT_PAGE_SIZE,
        connectionPageSize: GAME_OPPONENT_SCAN_PAGE_SIZE,
        beforeFilterPage: async (pageUsers) => {
          const merged = new Set([
            ...watchedPresenceIdsRef.current,
            ...Array.from(opponentShownIdsRef.current),
            ...pageUsers.map((u) => u._id),
          ]);
          watchedPresenceIdsRef.current = Array.from(merged);
          setPresenceWatchUserIds?.(watchedPresenceIdsRef.current);
          refreshPresenceSubscription?.();
          // One short presence settle — not per API page (that made the modal feel slow).
          if (!presencePrimed) {
            presencePrimed = true;
            await new Promise((r) => setTimeout(r, 120));
          }
        },
      });
      opponentPagerRef.current = pager;
      for (const u of users) opponentShownIdsRef.current.add(u._id);

      setAvailableUsers((prev) => (mode === 'replace' ? users : [...prev, ...users]));
      setHasMoreOpponents(!pager.done);
    } catch (error) {
      console.error('Error fetching available users:', error);
      if (mode === 'replace') {
        showToast('Error', 'Failed to fetch users', 'error');
        setAvailableUsers([]);
        setHasMoreOpponents(false);
      }
    } finally {
      if (mode === 'replace') setLoadingUsers(false);
      else setLoadingMoreUsers(false);
    }
  }, [
    user?._id,
    loadingMoreUsers,
    loadingUsers,
    busyChessUserIds,
    busyCardUserIds,
    isUserOnline,
    refreshPresenceSubscription,
    setPresenceWatchUserIds,
    showToast,
  ]);

  const handleOpenChessModal = () => {
    setShowChessModal(true);
    void fetchAvailableUsers('replace');
  };

  const handleOpenCardModal = () => {
    setShowCardModal(true);
    void fetchAvailableUsers('replace');
  };

  const handleLoadMoreOpponents = useCallback(() => {
    if (!hasMoreOpponents || loadingMoreUsers || loadingUsers) return;
    void fetchAvailableUsers('append');
  }, [hasMoreOpponents, loadingMoreUsers, loadingUsers, fetchAvailableUsers]);

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
    if (item?.kind === 'ad') {
      return <FeedNativeAd slotKey={item.key} />;
    }
    const post = item?.kind === 'post' ? item.post : item;
    // Live stream pseudo-post — show dedicated live card
    if (post.isLive) return <LivePostCard post={post} />;

    const uid = post.postedBy?._id?.toString?.() ?? '';
    const ring = uid ? storyByUserId[uid] : undefined;
    const postId = post?._id?.toString?.() ?? String(post?._id ?? '');
    return (
      <Post
        post={post}
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
    const nextVisibleIds = viewableItems
      .filter((entry) => entry?.isViewable)
      .map((entry) => {
        const row = entry?.item;
        const post = row?.kind === 'post' ? row.post : row?.kind === 'ad' ? null : row;
        return post?._id?.toString?.() ?? String(post?._id ?? '');
      })
      .filter(Boolean);
    emitFeedVisiblePostIds(nextVisibleIds);

    const visibleMedia = viewableItems.filter((entry) => {
      if (!entry?.isViewable) return false;
      const row = entry?.item;
      const post = row?.kind === 'post' ? row.post : row?.kind === 'ad' ? null : row;
      return post && isFeedAutoPlayMediaPost(post);
    });

    // Prefer the lower/next visible video so scrolling down activates the post in focus.
    const preferred = visibleMedia.length > 0 ? visibleMedia[visibleMedia.length - 1] : null;
    const preferredPost = preferred?.item?.kind === 'post' ? preferred.item.post : preferred?.item;
    const nextId = preferredPost?._id?.toString?.() ?? null;
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
      <Animated.View
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setFeedHeaderHeight(h);
        }}
        style={[
          styles.header,
          styles.headerFloating,
          headerTranslateStyle,
          { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border },
        ]}
      >
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('feed')}</Text>
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
      </Animated.View>

      <Animated.View
        style={[
          styles.feedListWrap,
          { transform: [{ translateY: feedLandAnim }] },
        ]}
      >
      <FlatList
        ref={feedListRef}
        data={loading ? [] : feedRows}
        renderItem={renderPost}
        extraData={{ activeVideoPostId, videoAutoplayReady, isScreenFocused, storyRingReplayKey }}
        removeClippedSubviews={false}
        ItemSeparatorComponent={() => <View style={styles.postSeparator} />}
        keyExtractor={(item, index) => {
          if (item?.kind === 'ad') return item.key || `ad-${index}`;
          const post = item?.kind === 'post' ? item.post : item;
          const id = post?._id?.toString?.() ?? String(post?._id);
          return id || `post-${index}`;
        }}
        contentContainerStyle={[styles.listContainer, { paddingTop: feedHeaderHeight, paddingBottom: 20 + tabBarHeight }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            progressViewOffset={feedHeaderHeight + (Platform.OS === 'android' ? 8 : 0)}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.35}
        onScroll={mergeOnScroll(mergeTabBarScroll(handleFeedScroll))}
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
      </Animated.View>

      {/* Instagram-style "New posts" pill — top center under header */}
      <Animated.View
        pointerEvents={hasNewPosts ? 'box-none' : 'none'}
        style={[
          styles.newPostsWrap,
          { top: Math.max(feedHeaderHeight, 56) + 10 },
          {
            opacity: newPostsAppearAnim,
            transform: [
              {
                translateY: newPostsAppearAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-14, 0],
                }),
              },
              { scale: newPostsPulseAnim },
            ],
          },
        ]}
      >
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={scrollFeedToTop}
          accessibilityRole="button"
          accessibilityLabel="See new posts"
          style={[styles.newPostsPill, { backgroundColor: colors.primary }]}
        >
          <View style={styles.newPostsIconWrap}>
            <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
              <Path
                d="M6 15l6-6 6 6"
                stroke="#FFFFFF"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </View>
          <Text style={styles.newPostsText}>
            {pendingNewPostsCount > 1
              ? `${pendingNewPostsCount} new posts`
              : 'New posts'}
          </Text>
        </TouchableOpacity>
      </Animated.View>

      {/* Floating scroll-to-top arrow (bottom) — hidden while new-posts pill is up */}
      <Animated.View
        pointerEvents={showScrollTop && !hasNewPosts ? 'box-none' : 'none'}
        style={[
          styles.scrollTopWrap,
          { bottom: tabBarHeight + 20 },
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
          accessibilityLabel="Scroll to top"
          style={[styles.scrollTopButton, { backgroundColor: colors.primary }]}
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
        </TouchableOpacity>
      </Animated.View>

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
        onUserPress={(username) => {
          setShowActivityModal(false);
          // Defer so modal unmount doesn't swallow the navigation.
          requestAnimationFrame(() => navigateToUserProfile(username));
        }}
        onActivityClick={(activity) => {
          if (activity.postId?._id) {
            navigation.navigate('PostDetail', { postId: activity.postId._id });
            setShowActivityModal(false);
          } else if (activity.targetUser?.username) {
            setShowActivityModal(false);
            requestAnimationFrame(() =>
              navigateToUserProfile(activity.targetUser!.username),
            );
          } else if (activity.userId?.username) {
            setShowActivityModal(false);
            requestAnimationFrame(() => navigateToUserProfile(activity.userId.username));
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
                onEndReached={handleLoadMoreOpponents}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  loadingMoreUsers ? (
                    <View style={styles.modalLoading}>
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    </View>
                  ) : null
                }
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
                onEndReached={handleLoadMoreOpponents}
                onEndReachedThreshold={0.4}
                ListFooterComponent={
                  loadingMoreUsers ? (
                    <View style={styles.modalLoading}>
                      <ActivityIndicator size="small" color={COLORS.primary} />
                    </View>
                  ) : null
                }
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
  feedListWrap: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerFloating: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    elevation: 20,
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
    alignSelf: 'center',
    zIndex: 30,
  },
  newPostsWrap: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 40,
    elevation: 40,
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
    gap: 8,
    paddingLeft: 12,
    paddingRight: 18,
    paddingVertical: 11,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 10,
  },
  newPostsIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newPostsText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
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
