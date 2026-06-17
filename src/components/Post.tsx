import React, { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Dimensions,
  ActivityIndicator,
  Linking,
  ScrollView,
  Modal,
  FlatList,
  DeviceEventEmitter,
  Pressable,
} from 'react-native';
import { WebView } from 'react-native-webview';
import YoutubePlayer from 'react-native-youtube-iframe';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { useUser } from '../context/UserContext';
import { usePost } from '../context/PostContext';
import { useTheme } from '../context/ThemeContext';
import { useSocket } from '../context/SocketContext';
import { apiService } from '../services/api';
import { ENDPOINTS, COLORS, WEB_APP_URL, CHESS_GAME_FEED_UI_ENDED } from '../utils/constants';
import {
  isChessRoomFeedEnded,
  markChessRoomFeedEnded,
  subscribeChessFeedEndedStore,
} from '../utils/chessFeedEndedStore';
import { useShowToast } from '../hooks/useShowToast';
import { useLanguage } from '../context/LanguageContext';
import VideoFeedPreview from './VideoFeedPreview';
import AddContributorModal from './AddContributorModal';
import ManageContributorsModal from './ManageContributorsModal';
import EditPostModal from './EditPostModal';
import StoryAvatarRing from './StoryAvatarRing';
import StoryOrProfileSheet from './StoryOrProfileSheet';
import FootballMatchCard from './FootballMatchCard';
import SafeImage from './SafeImage';
import PinchZoomImageModal from './PinchZoomImageModal';
import FeedPostImageZoom from './FeedPostImageZoom';
import { navigateToMainStack } from '../utils/navigationHelpers';
import {
  isGoFishFeedPost,
  isChessFeedPost,
  getCardGameDataForPost,
  getChessGameDataForPost,
  getGameRoomIdFromPost,
} from '../utils/gameFeedPostUtils';
import { useFeedCardMetrics } from '../utils/feedCardLayout';
import { mediaDisplayUrl } from '../utils/mediaUrl';

const INLINE_VIDEO_CONTAIN_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%;
    height: 100%;
    background: #000;
    overflow: hidden;
  }
  video {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #000;
  }
`;

interface PostProps {
  post: any;
  disableNavigation?: boolean; // If true, disable navigation to PostDetail (for PostDetailScreen)
  fromScreen?: string; // Screen name where Post is rendered (e.g., 'UserProfile')
  userProfileParams?: any; // Params to pass when navigating back to UserProfile
  autoPlayMedia?: boolean; // Force media autoplay (used in PostDetail)
  /** When the post is updated in-place (e.g. contributors), parent can sync local state (Post detail). */
  onPostUpdated?: (updated: any) => void;
  /** Feed: active story for this author (for ring + tap menu). */
  storyRing?: { storyId: string; hasUnviewed: boolean } | null;
  /** Bumps on feed focus — restarts story ring fill animation */
  storyRingReplayKey?: number;
  /** Post detail: show only this live match card (same id as comment navigation). */
  footballFocusMatchId?: string;
  /** Full-bleed: no side margins (e.g. Post detail). Feed uses default card width like other posts. */
  fullWidthCard?: boolean;
  /** Home feed: match LivePostCard width + full-bleed media (keeps avatar/name/date). */
  feedWideCard?: boolean;
  /** Fired after a successful delete (own post or own channel card) so parent lists with their own state can drop it immediately. */
  onPostDeleted?: (postId: string) => void;
}

const Post: React.FC<PostProps> = ({
  post,
  disableNavigation = false,
  fromScreen,
  userProfileParams,
  autoPlayMedia = false,
  onPostUpdated,
  storyRing,
  storyRingReplayKey = 0,
  footballFocusMatchId,
  fullWidthCard = false,
  feedWideCard = false,
  onPostDeleted,
}) => {
  const isAnimatedImageUrl = (url: string) => {
    const raw = String(url || '');
    // Keep original source for animated formats to avoid losing animation
    // via delivery transforms.
    return /\.(gif|webp)(?:$|[?#])/i.test(raw);
  };

  const navigation = useNavigation<any>();

  // Helper function to navigate to PostDetail (feed stack, profile stack, or tab fallback)
  const navigateToPostDetail = useCallback((postId: string, extra?: Record<string, unknown>) => {
    const id = String(postId || '').trim();
    if (!id) return;

    const postImg = String(post?.img || '');
    const isPostVideo =
      !!postImg &&
      (/\.(mp4|webm|ogg|mov)$/i.test(postImg) || postImg.includes('/video/upload/'));

    try {
      if (!disableNavigation && isPostVideo) {
        setIsFeedVideoPausedByUser(true);
        setIsFeedVideoPlaying(false);
        setFeedVideoPreviewTimeMs(Math.max(1000, Math.floor(lastFeedVideoTimeRef.current * 1000)));
        feedVideoWebViewRef.current?.injectJavaScript(`
          (function () {
            var v = document.getElementById('v');
            if (!v) return;
            try { v.pause(); } catch (_) {}
          })();
          true;
        `);
      }
    } catch (_) {}

    const params = {
      postId: id,
      fromScreen,
      userProfileParams,
      ...extra,
    };

    const tryOpenOnNavigator = (nav: any): boolean => {
      if (!nav) return false;
      try {
        const state = nav.getState?.() as { routeNames?: string[]; routes?: { name: string }[] } | undefined;
        const names = state?.routeNames ?? state?.routes?.map((r) => r.name) ?? [];
        if (names.includes('PostDetail')) {
          if (typeof nav.push === 'function') {
            nav.push('PostDetail', params);
          } else {
            nav.navigate('PostDetail', params);
          }
          return true;
        }
      } catch (_) {}
      return false;
    };

    if (tryOpenOnNavigator(navigation)) return;
    if (tryOpenOnNavigator(navigation.getParent?.())) return;

    try {
      navigation.dispatch(
        CommonActions.navigate({
          name: 'PostDetail',
          params,
        }),
      );
      return;
    } catch (_) {}

    const tabNav = navigation.getParent?.()?.getParent?.() ?? navigation.getParent?.();
    if (tabNav?.navigate) {
      tabNav.navigate('Feed', { screen: 'PostDetail', params });
    }
  }, [navigation, disableNavigation, fromScreen, userProfileParams, post?.img]);

  const navigateToUserProfile = useCallback((usernameOrId: string) => {
    const query = String(usernameOrId || '').trim();
    if (!query) return;

    const params = { username: query };

    const tryPushUserProfile = (nav: any): boolean => {
      if (!nav) return false;
      try {
        const state = nav.getState?.() as { routeNames?: string[] } | undefined;
        const names = state?.routeNames ?? [];
        if (names.includes('UserProfile')) {
          if (typeof nav.push === 'function') {
            nav.push('UserProfile', params);
          } else {
            nav.navigate('UserProfile', params);
          }
          return true;
        }
      } catch (_) {}
      return false;
    };

    if (tryPushUserProfile(navigation)) return;
    if (tryPushUserProfile(navigation.getParent?.())) return;

    const tabNav = navigation.getParent?.();
    if (tabNav?.navigate) {
      tabNav.navigate('Profile', { screen: 'UserProfile', params });
      return;
    }

    navigation.navigate('Profile', {
      screen: 'UserProfile',
      params,
    });
  }, [navigation]);

  /** Football feed card: header/avatar open the Football tab; 💬 still opens this post for comments. */
  const navigateToFootballTab = () => {
    try {
      let nav: any = navigation;
      for (let i = 0; i < 5 && nav; i++) {
        const state = nav.getState?.();
        const names = state?.routeNames;
        if (Array.isArray(names) && names.includes('Football')) {
          nav.navigate('Football');
          return;
        }
        nav = nav.getParent?.();
      }
      navigation.navigate('Football');
    } catch (e) {}
  };

  const { user } = useUser();
  const {
    likePost,
    unlikePost,
    deletePost: deletePostContext,
    updatePost,
    hideFeedPostFromFeed,
    hideFeedSourceFromFeed,
    addHiddenFeedPostId,
  } = usePost();
  const { t, isRTL } = useLanguage();
  const { colors } = useTheme();
  const { socket, isUserOnline } = useSocket();
  const showToast = useShowToast();

  const [addContribOpen, setAddContribOpen] = useState(false);
  const [manageContribOpen, setManageContribOpen] = useState(false);
  const [editPostOpen, setEditPostOpen] = useState(false);
  const [storyMenu, setStoryMenu] = useState<{ userId: string; username: string } | null>(null);
  const [postImagePreviewOpen, setPostImagePreviewOpen] = useState(false);

  // Contributor hydration: sometimes API/socket returns contributor ids only. Fetch profiles so avatars show without reload.
  const [contribHydrateMap, setContribHydrateMap] = useState<Record<string, any>>({});
  const contribHydrateInFlightRef = useRef<Record<string, boolean>>({});

  const contributorIdsNeedingHydration = useMemo(() => {
    if (!post?.isCollaborative || !Array.isArray(post?.contributors)) return [];
    const ids: string[] = [];
    for (const c of post.contributors) {
      const id =
        typeof c === 'string' || typeof c === 'number'
          ? String(c)
          : c?._id != null
            ? String(c._id)
            : '';
      if (!id) continue;
      const hasPic = typeof c === 'object' && !!c?.profilePic;
      const already = !!contribHydrateMap[id];
      if (!hasPic && !already) ids.push(id);
    }
    return ids.slice(0, 12);
  }, [post?.isCollaborative, post?.contributors, contribHydrateMap]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!contributorIdsNeedingHydration.length) return;
      const todo = contributorIdsNeedingHydration.filter((id) => !contribHydrateInFlightRef.current[id]);
      if (!todo.length) return;
      todo.forEach((id) => (contribHydrateInFlightRef.current[id] = true));
      try {
        const results = await Promise.all(
          todo.map(async (id) => {
            try {
              // Backend supports both username or userId: /api/user/getUserPro/:query
              const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${encodeURIComponent(String(id))}`);
              const u = (data as any)?.user ?? data;
              const uid = u?._id != null ? String(u._id) : id;
              return uid ? { id: uid, user: u } : null;
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        const next: Record<string, any> = {};
        for (const r of results) {
          if (r?.id && r.user) next[r.id] = r.user;
        }
        if (Object.keys(next).length) {
          setContribHydrateMap((prev) => ({ ...prev, ...next }));
        }
      } finally {
        todo.forEach((id) => (contribHydrateInFlightRef.current[id] = false));
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [contributorIdsNeedingHydration]);

  const [isLiking, setIsLiking] = useState(false);
  /** Optimistic per-match like (football stacked cards) — key = footballMatchId */
  const [matchLikeOverride, setMatchLikeOverride] = useState<
    Record<string, { liked: boolean; count: number }>
  >({});
  const [footballMatchLikingId, setFootballMatchLikingId] = useState<string | null>(null);
  const [isFeedVideoMuted, setIsFeedVideoMuted] = useState(true);
  const [feedVideoReady, setFeedVideoReady] = useState(false);
  const [isFeedVideoPausedByUser, setIsFeedVideoPausedByUser] = useState(false);
  const [isFeedVideoPlaying, setIsFeedVideoPlaying] = useState(false);
  /** Once the in-feed video errors (e.g. dead remote URL), keep the WebView un-mounted so it doesn't keep retrying and pressuring memory across long feeds. */
  const [feedVideoErrored, setFeedVideoErrored] = useState(false);
  const feedVideoWebViewRef = useRef<WebView>(null);
  const detailVideoWebViewRef = useRef<WebView>(null);
  const autoPlayMediaRef = useRef(autoPlayMedia);
  autoPlayMediaRef.current = autoPlayMedia;
  const lastFeedVideoTimeRef = useRef(0);

  const pauseDetailVideo = useCallback(() => {
    detailVideoWebViewRef.current?.injectJavaScript(`
      (function () {
        var v = document.querySelector('video');
        if (!v) return;
        try { v.pause(); v.removeAttribute('src'); v.load(); } catch (_) {}
      })();
      true;
    `);
  }, []);

  useEffect(() => {
    if (!disableNavigation) return;
    if (!autoPlayMedia) {
      pauseDetailVideo();
      setYoutubePlaying(false);
    }
  }, [disableNavigation, autoPlayMedia, pauseDetailVideo]);
  const lastFeedVideoTimeUpdateRef = useRef(0);
  const [feedVideoPreviewTimeMs, setFeedVideoPreviewTimeMs] = useState(1000);
  const resumeFeedVideo = () => {
    setIsFeedVideoPausedByUser(false);
    setIsFeedVideoPlaying(true);
    feedVideoWebViewRef.current?.injectJavaScript(`
      (function () {
        var v = document.getElementById('v');
        if (!v) return;
        if (${lastFeedVideoTimeRef.current.toFixed(3)} > 0 && Math.abs(v.currentTime - ${lastFeedVideoTimeRef.current.toFixed(3)}) > 0.35) {
          try { v.currentTime = ${lastFeedVideoTimeRef.current.toFixed(3)}; } catch (_) {}
        }
        var p = v.play();
        if (p && p.catch) p.catch(function(){});
      })();
      true;
    `);
  };

  useEffect(() => {
    setMatchLikeOverride({});
  }, [post?._id]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [sendingShareToId, setSendingShareToId] = useState<string | null>(null);
  const [capsuleModalVisible, setCapsuleModalVisible] = useState(false);
  const [capsuleLoadingDuration, setCapsuleLoadingDuration] = useState<string | null>(null);
  const [capsuleLoading, setCapsuleLoading] = useState(false);
  const [capsuleSealed, setCapsuleSealed] = useState(false);
  const [capsuleSelectedLabel, setCapsuleSelectedLabel] = useState('');
  const [youtubePlaying, setYoutubePlaying] = useState(true);
  // Local state for optimistic like updates (like web)
  const [localLiked, setLocalLiked] = useState(post.likes?.includes(user?._id));
  const [localLikesCount, setLocalLikesCount] = useState(post.likes?.length || 0);
  
  // Weather post state
  const isWeatherPost = post.postedBy?.username === 'Weather' && post.weatherData;
  const [weatherDataArray, setWeatherDataArray] = useState<any[]>([]);
  const [weatherLoading, setWeatherLoading] = useState(false);

  // Football post detection
  const isFootballPost = post.isFootballPost || post.postedBy?.username === 'Football';

  // Chess / card game post state
  const isChessPost = isChessFeedPost(post);
  const isCardPost = isGoFishFeedPost(post);
  const [chessGameData, setChessGameData] = useState<any>(null);
  const [cardGameData, setCardGameData] = useState<any>(null);
  /** When socket says this room ended, flip Live → Ended without waiting for a feed refresh */
  const [chessFeedEndedLocally, setChessFeedEndedLocally] = useState(false);
  const [cardFeedEndedLocally, setCardFeedEndedLocally] = useState(false);

  // Football post state - fetch matches from API
  const [footballMatches, setFootballMatches] = useState<any[]>([]);
  const [footballLoading, setFootballLoading] = useState(false);
  
  useEffect(() => {
    setChessGameData(isChessPost ? getChessGameDataForPost(post) : null);
  }, [isChessPost, post?.chessGameData, post?.text, post?.postedBy?._id, post?.postedBy?.name]);

  useEffect(() => {
    setCardGameData(isCardPost ? getCardGameDataForPost(post) : null);
  }, [isCardPost, post?.cardGameData, post?.text, post?.postedBy?._id, post?.postedBy?.name]);

  const cardRoomIdForFeed = useMemo(() => {
    if (!isCardPost) return '';
    return getGameRoomIdFromPost(post);
  }, [isCardPost, post?.cardGameData, post?.text]);

  useEffect(() => {
    if (!cardRoomIdForFeed) {
      setCardFeedEndedLocally(false);
      return;
    }
    const sync = () => setCardFeedEndedLocally(isChessRoomFeedEnded(cardRoomIdForFeed));
    sync();
    const unsubStore = subscribeChessFeedEndedStore(sync);
    const sub = DeviceEventEmitter.addListener(
      CHESS_GAME_FEED_UI_ENDED,
      (payload: { roomId?: string }) => {
        const r = payload?.roomId != null ? String(payload.roomId).trim() : '';
        if (r && r === cardRoomIdForFeed) {
          markChessRoomFeedEnded(r);
          sync();
        }
      },
    );
    return () => {
      unsubStore();
      sub.remove();
    };
  }, [cardRoomIdForFeed]);

  /** Room id from props (immediate) — avoids one frame of stale `chessGameData` state so feed listeners match the second game. */
  const chessRoomIdForFeed = useMemo(() => {
    if (!isChessPost || !post?.chessGameData) return '';
    try {
      const p =
        typeof post.chessGameData === 'string' ? JSON.parse(post.chessGameData) : post.chessGameData;
      return p?.roomId != null ? String(p.roomId).trim() : '';
    } catch {
      return '';
    }
  }, [isChessPost, post?.chessGameData]);

  useEffect(() => {
    if (!chessRoomIdForFeed) {
      setChessFeedEndedLocally(false);
      return;
    }
    const sync = () => setChessFeedEndedLocally(isChessRoomFeedEnded(chessRoomIdForFeed));
    sync();
    const unsubStore = subscribeChessFeedEndedStore(sync);
    const sub = DeviceEventEmitter.addListener(
      CHESS_GAME_FEED_UI_ENDED,
      (payload: { roomId?: string }) => {
        const r = payload?.roomId != null ? String(payload.roomId).trim() : '';
        if (r && r === chessRoomIdForFeed) {
          markChessRoomFeedEnded(r);
          sync();
        }
      },
    );
    return () => {
      unsubStore();
      sub.remove();
    };
  }, [post?._id, chessRoomIdForFeed]);

  // Do not auto-navigate from the feed into ChessGame — it caused false opens after cancel/reconnect
  // and duplicated AppNavigator's acceptChessChallenge handling. Players open the game from the modal / socket.

  // Fetch football matches for football posts (reusable function)
  const fetchFootballMatches = React.useCallback(async (silent = false) => {
    if (!isFootballPost) return;

    try {
      if (!silent) {
        setFootballLoading(true);
      }
      
      const today = new Date().toISOString().split('T')[0];
      
      // Fetch ONLY live matches (today) - no upcoming matches in feed
      const liveData = await apiService.get(
        `${ENDPOINTS.GET_MATCHES}?status=live&date=${today}`
      );
      const liveMatches = liveData.matches || [];
      
      // Only set live matches (no upcoming matches in feed)
      setFootballMatches(liveMatches);
      
    } catch (error: any) {
      console.error('⚽ [Post] Error fetching football matches:', error);
    } finally {
      if (!silent) {
        setFootballLoading(false);
      }
    }
  }, [isFootballPost]);

  // Initial fetch on mount
  useEffect(() => {
    if (!isFootballPost) return;

    fetchFootballMatches();
  }, [isFootballPost, fetchFootballMatches]);

  // Listen for real-time match updates via socket
  useEffect(() => {
    if (!isFootballPost || !socket) return;

    const handleFootballMatchUpdate = () => {
      fetchFootballMatches(true); // Silent refresh (no loading spinner)
    };

    const handleFootballPageUpdate = (_data: any) => {
      fetchFootballMatches(true); // Silent refresh
    };

    socket.on('footballMatchUpdate', handleFootballMatchUpdate);
    socket.on('footballPageUpdate', handleFootballPageUpdate);

    return () => {
      socket.off('footballMatchUpdate', handleFootballMatchUpdate);
      socket.off('footballPageUpdate', handleFootballPageUpdate);
    };
  }, [isFootballPost, socket, fetchFootballMatches]);

  const footballMatchesSource = useMemo(() => {
    if (!isFootballPost) return [];
    const arr =
      footballMatches.length > 0
        ? footballMatches
        : post.liveMatches || post.matches || post.todayMatches || [];
    return Array.isArray(arr) ? arr : [];
  }, [isFootballPost, footballMatches, post.liveMatches, post.matches, post.todayMatches]);

  const footballLiveMatches = useMemo(() => {
    return footballMatchesSource.filter((m: any) => {
      const u = String(m.fixture?.status?.short || m.fixture?.status?.long || m.status || '')
        .trim()
        .toUpperCase();
      if (!u && m.fixture?.status?.elapsed != null) return true;
      if (['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO'].includes(u)) return false;
      if (['LIVE', 'IN_PLAY', 'PAUSED', '1H', '2H', 'HT', 'ET', 'BT', 'P'].includes(u)) return true;
      const elapsed = m.fixture?.status?.elapsed;
      if (elapsed != null && Number(elapsed) >= 0 && u !== 'NS' && u !== 'TBD') return true;
      return false;
    });
  }, [footballMatchesSource]);

  const footballLiveMatchesDisplayed = useMemo(() => {
    if (!footballFocusMatchId) return footballLiveMatches;
    const focus = String(footballFocusMatchId);
    const filtered = footballLiveMatches.filter((m: any, index: number) => {
      const fid =
        m._id != null
          ? String(m._id)
          : m.fixture?.id != null
            ? String(m.fixture.id)
            : `idx-${index}`;
      return fid === focus;
    });
    return filtered.length > 0 ? filtered : footballLiveMatches;
  }, [footballLiveMatches, footballFocusMatchId]);

  const showStackedFootballMatchActions =
    isFootballPost && !footballLoading && footballLiveMatches.length > 0 && !disableNavigation;

  /** Post detail: match rows already include like/comment — hide duplicate post-level footer (web-style). */
  const hidePostFooterForFootballDetail =
    isFootballPost &&
    disableNavigation &&
    !footballLoading &&
    footballLiveMatches.length > 0;

  /** No live rows: hide post-level ❤️/💬 when the empty copy is shown (not legacy `post.footballData`). */
  const hideFootballFooterWhenNoMatchEmpty =
    isFootballPost &&
    !footballLoading &&
    footballLiveMatches.length === 0 &&
    (footballMatchesSource.length > 0 || (footballMatchesSource.length === 0 && !post.footballData));
  const showFeedExtras = !disableNavigation && fromScreen !== 'UserProfile' && fromScreen !== 'PostDetail';

  /** Top-level comment count per footballMatchId, including all nested replies in those threads. */
  const footballMatchReplyCounts = useMemo(() => {
    if (!isFootballPost) return new Map<string, number>();
    const all = Array.isArray(post.replies) ? post.replies : [];
    const rootsByMatch = new Map<string, Set<string>>();
    for (const r of all) {
      if (r?.parentReplyId) continue;
      const fid = String(r?.footballMatchId || '');
      if (!fid) continue;
      const id = r?._id != null ? String(r._id) : '';
      if (!id) continue;
      if (!rootsByMatch.has(fid)) rootsByMatch.set(fid, new Set());
      rootsByMatch.get(fid)!.add(id);
    }
    const counts = new Map<string, number>();
    for (const [fid, seedIds] of rootsByMatch) {
      const inThread = new Set<string>(seedIds);
      let added = true;
      while (added) {
        added = false;
        for (const r of all) {
          const id = r?._id != null ? String(r._id) : '';
          if (!id || inThread.has(id)) continue;
          const p = r.parentReplyId != null ? String(r.parentReplyId) : '';
          if (p && inThread.has(p)) {
            inThread.add(id);
            added = true;
          }
        }
      }
      counts.set(fid, inThread.size);
    }
    return counts;
  }, [isFootballPost, post.replies]);

  const openGamePostDetails = useCallback(() => {
    if (disableNavigation || !post?._id) return;
    navigateToPostDetail(String(post._id));
  }, [disableNavigation, post?._id, navigateToPostDetail]);

  const resolveGameOpponentId = useCallback(
    (player1Id?: string, player2Id?: string) => {
      const p1 = player1Id != null ? String(player1Id) : '';
      const p2 = player2Id != null ? String(player2Id) : '';
      const me = user?._id?.toString?.() ?? (user?._id ? String(user._id) : '');
      if (!p1 && !p2) return '';
      if (me && me === p1) return p2 || p1;
      if (me && me === p2) return p1 || p2;
      return p1 || p2;
    },
    [user?._id],
  );

  /** Game card tap — watch live match (not post details). */
  const watchChessGame = useCallback(() => {
    if (!chessGameData?.roomId) {
      showToast('Error', 'Invalid chess game data', 'error');
      return;
    }
    const opponentId = resolveGameOpponentId(
      chessGameData.player1?._id,
      chessGameData.player2?._id,
    );
    navigateToMainStack(navigation, 'ChessGame', {
      roomId: chessGameData.roomId,
      opponentId: opponentId || chessGameData.player1?._id,
      color: 'white',
      isSpectator: true,
    });
  }, [chessGameData, resolveGameOpponentId, navigation, showToast]);

  // Update local state when post prop changes
  useEffect(() => {
    setLocalLiked(post.likes?.includes(user?._id));
    setLocalLikesCount(post.likes?.length || 0);
  }, [post.likes, user?._id]);

  useEffect(() => {
    // Default to muted in feed (Twitter/X style).
    setIsFeedVideoMuted(true);
  }, [post?._id]);

  useEffect(() => {
    setFeedVideoReady(false);
    setIsFeedVideoPlaying(false);
    setFeedVideoErrored(false);
    lastFeedVideoTimeRef.current = 0;
    setFeedVideoPreviewTimeMs(1000);
  }, [post?._id]);

  useEffect(() => {
    // New post or leaving viewport should reset manual pause so auto-play feels consistent.
    if (!autoPlayMedia) {
      // Off-screen feed cell: hard pause WebView media and keep preview at last frame time.
      try {
        feedVideoWebViewRef.current?.injectJavaScript(`
          (function () {
            var v = document.getElementById('v');
            if (!v) return;
            try { v.pause(); } catch (_) {}
          })();
          true;
        `);
      } catch (_) {}
      setIsFeedVideoPausedByUser(false);
      setIsFeedVideoPlaying(false);
      setFeedVideoPreviewTimeMs(Math.max(1000, Math.floor(lastFeedVideoTimeRef.current * 1000)));
    }
  }, [autoPlayMedia, post?._id]);

  // Ensure media starts playing when opening PostDetail.
  useEffect(() => {
    if (disableNavigation && autoPlayMedia) {
      setYoutubePlaying(true);
    }
  }, [disableNavigation, autoPlayMedia, post?._id]);

  // Load personalized weather data for weather posts
  useEffect(() => {
    if (!isWeatherPost || !post?.weatherData) {
      setWeatherDataArray([]);
      setWeatherLoading(false);
      return;
    }

    const loadPersonalizedWeather = async () => {
      setWeatherLoading(true);
      
      try {
        // Parse weatherData from JSON string
        let allWeatherData: any[] = [];
        try {
          const parsed = typeof post.weatherData === 'string' 
            ? JSON.parse(post.weatherData) 
            : post.weatherData;
          allWeatherData = Array.isArray(parsed) ? parsed : [];
        } catch (e) {
          console.error('❌ [Post] Error parsing weatherData:', e);
          setWeatherLoading(false);
          return;
        }

        // If user is logged in, fetch their preferences and filter
        if (user?._id) {
          try {
            const prefsRes = await apiService.get(ENDPOINTS.GET_WEATHER_PREFERENCES);
            const prefsData = prefsRes;

            // Get user's selected city names
            const selectedCityNames = prefsData?.selectedCities || prefsData?.cities?.map((c: any) => c.name || c) || [];

            if (selectedCityNames.length > 0) {
              // Filter to show only user's selected cities
              // Use flexible matching: handle "Amman, JO" vs "Amman" or case differences
              const filtered = allWeatherData.filter((w: any) => {
                const weatherCityName = w.city?.toLowerCase().trim() || '';
                // Remove country code if present (e.g., "Amman, JO" -> "amman")
                const weatherCityBase = weatherCityName.split(',')[0].trim();
                
                const matches = selectedCityNames.some((cityName: string) => {
                  const selectedCityName = cityName.toLowerCase().trim();
                  // Check exact match
                  if (weatherCityName === selectedCityName || weatherCityBase === selectedCityName) return true;
                  // Check if weather city contains selected city name (for "Amman, JO" vs "Amman")
                  if (weatherCityBase.includes(selectedCityName) || selectedCityName.includes(weatherCityBase)) return true;
                  return false;
                });
                return matches;
              });

              setWeatherDataArray(filtered);
            } else {
              // No cities selected, show default cities (first 5)
              setWeatherDataArray(allWeatherData.slice(0, 5));
            }
          } catch (error) {
            console.error('❌ [Post] Error fetching weather preferences:', error);
            // Fallback to default cities
            setWeatherDataArray(allWeatherData.slice(0, 5));
          }
        } else {
          // Not logged in, show default cities
          setWeatherDataArray(allWeatherData.slice(0, 5));
        }
      } catch (error) {
        console.error('❌ [Post] Error loading weather:', error);
        setWeatherDataArray([]);
      } finally {
        setWeatherLoading(false);
      }
    };

    loadPersonalizedWeather();
  }, [isWeatherPost, post?.weatherData, user?._id]);

  const isLiked = localLiked; // Use local state for immediate UI update

  const postedById =
    (typeof post.postedBy === 'string' ? post.postedBy : post.postedBy?._id)?.toString?.() ??
    String(typeof post.postedBy === 'string' ? post.postedBy : post.postedBy?._id ?? '');
  const currentUserId = user?._id?.toString?.() ?? (user?._id ? String(user._id) : '');

  const isOwner = !!postedById && !!currentUserId && postedById === currentUserId;
  const isContributor = post.contributors?.some((c: any) => {
    const cId = (typeof c === 'string' ? c : c?._id)?.toString?.() ?? String(typeof c === 'string' ? c : c?._id);
    return !!cId && !!currentUserId && cId === currentUserId;
  });

  const isFollowedAuthor = useMemo(() => {
    if (!showFeedExtras || !user?.following?.length || !postedById || isOwner) return false;
    return user.following.some((entry: any) => {
      const fid =
        typeof entry === 'object' && entry != null
          ? entry._id?.toString?.() ?? String(entry._id ?? '')
          : String(entry ?? '');
      return !!fid && fid === postedById;
    });
  }, [showFeedExtras, user?.following, postedById, isOwner]);

  const showAuthorPresenceDot =
    isFollowedAuthor &&
    !isChannelPost &&
    !isFootballPost &&
    !isWeatherPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive;

  const authorIsOnline = showAuthorPresenceDot && isUserOnline(postedById);

  const canAddCollaborator =
    !!post.isCollaborative && (isOwner || !!isContributor);
  const canManageContributorsList =
    (isOwner || !!isContributor) &&
    !!post.isCollaborative &&
    Array.isArray(post.contributors) &&
    post.contributors.length > 0;

  const isCapsuleEligiblePost = useMemo(() => {
    const postId = String(post?._id || '');
    return !(
      post?.footballData ||
      post?.weatherData ||
      isChessFeedPost(post) ||
      isGoFishFeedPost(post) ||
      post?.raceGameData ||
      post?.isMatchReaction ||
      postId.startsWith('live_')
    );
  }, [post]);

  const permalink = useMemo(() => {
    const username = post?.postedBy?.username || post?.postedBy?.name || 'post';
    return `${WEB_APP_URL}/${username}/post/${post?._id}`;
  }, [post?._id, post?.postedBy?.username, post?.postedBy?.name]);

  const getConversationLabel = (conv: any) => {
    if (conv?.isGroup) return conv?.groupName || 'Group';
    const other = (conv?.participants || []).find((p: any) => String(p?._id || '') !== currentUserId);
    return other?.name || other?.username || 'Direct chat';
  };

  const getRecipientIdForDirect = (conv: any) => {
    if (conv?.isGroup) return null;
    const other = (conv?.participants || []).find((p: any) => String(p?._id || '') !== currentUserId);
    return other?._id || null;
  };

  const fetchConversations = async () => {
    if (!user) return;
    setLoadingConversations(true);
    try {
      const data: any = await apiService.get(`${ENDPOINTS.GET_CONVERSATIONS}?limit=30`);
      const list = Array.isArray(data?.conversations) ? data.conversations : (Array.isArray(data) ? data : []);
      setConversations(list);
    } catch (e) {
      showToast('Error', 'Could not load chats', 'error');
    } finally {
      setLoadingConversations(false);
    }
  };

  const openShareModal = async () => {
    if (!showFeedExtras || !user) return;
    setShareModalVisible(true);
    await fetchConversations();
  };

  const handleShareToConversation = async (conv: any) => {
    const convId = String(conv?._id || '');
    if (!convId || sendingShareToId) return;
    setSendingShareToId(convId);
    try {
      const isGroup = !!conv?.isGroup;
      const recipientId = getRecipientIdForDirect(conv);
      if (!isGroup && !recipientId) throw new Error('Missing recipient');
      await apiService.post(ENDPOINTS.SEND_MESSAGE, {
        message: `🔗 ${permalink}`,
        ...(isGroup ? { conversationId: convId } : { recipientId }),
      });
      showToast('Shared', `Sent to ${getConversationLabel(conv)}`, 'success');
      setShareModalVisible(false);
    } catch (_) {
      showToast('Error', 'Could not share post', 'error');
    } finally {
      setSendingShareToId(null);
    }
  };

  const fetchCapsuleStatus = async () => {
    if (!user || !post?._id || !isCapsuleEligiblePost) return;
    try {
      const data: any = await apiService.get(`/api/capsule/status/${post._id}`);
      if (data?.openAt) {
        setCapsuleSealed(true);
        setCapsuleSelectedLabel(data?.selectedLabel || '');
      } else {
        setCapsuleSealed(false);
        setCapsuleSelectedLabel('');
      }
    } catch (_) {}
  };

  const openCapsuleModal = async () => {
    if (!showFeedExtras || !user || !isCapsuleEligiblePost) return;
    setCapsuleModalVisible(true);
    await fetchCapsuleStatus();
  };

  const handleSealCapsule = async (duration: string) => {
    if (!user || !post?._id) return;
    setCapsuleLoadingDuration(duration);
    try {
      const data: any = await apiService.post('/api/capsule/seal', { postId: post._id, duration });
      setCapsuleSealed(true);
      setCapsuleSelectedLabel(data?.selectedLabel || '');
      showToast('Reminder set', 'We will notify you on time', 'success');
      setCapsuleModalVisible(false);
    } catch (e: any) {
      showToast('Error', e?.message || 'Could not set reminder', 'error');
    } finally {
      setCapsuleLoadingDuration(null);
    }
  };

  const handleUnsealCapsule = async () => {
    if (!user || !post?._id) return;
    setCapsuleLoading(true);
    try {
      await apiService.delete(`/api/capsule/unseal/${post._id}`);
      setCapsuleSealed(false);
      setCapsuleSelectedLabel('');
      showToast('Reminder removed', '', 'info');
      setCapsuleModalVisible(false);
    } catch (e: any) {
      showToast('Error', e?.message || 'Could not remove reminder', 'error');
    } finally {
      setCapsuleLoading(false);
    }
  };

  const onCollaborativePostUpdated = (updated: any) => {
    if (updated?._id) {
      updatePost(updated._id, updated);
      onPostUpdated?.(updated);
    }
  };

  const handleLike = async () => {
    if (isLiking || !user) return;

    // Optimistic update: Update UI immediately (like web)
    const previousLiked = isLiked;
    const previousCount = localLikesCount;
    
    setLocalLiked(!previousLiked);
    setLocalLikesCount(previousLiked ? previousCount - 1 : previousCount + 1);
    setIsLiking(true);

    try {
      await apiService.put(`${ENDPOINTS.LIKE_POST}/${post._id}`);
      
      // Update context after API call succeeds
      if (previousLiked) {
        unlikePost(post._id, user._id);
      } else {
        likePost(post._id, user._id);
      }
    } catch (error: any) {
      console.error('Error liking post:', error);
      // Revert optimistic update on error
      setLocalLiked(previousLiked);
      setLocalLikesCount(previousCount);
      showToast('Error', 'Failed to like post', 'error');
    } finally {
      setIsLiking(false);
    }
  };

  const matchLikeFromServer = (fid: string) => {
    const list = Array.isArray((post as any).footballMatchLikes) ? (post as any).footballMatchLikes : [];
    const entry = list.find((e: any) => String(e?.footballMatchId) === String(fid));
    const likes = Array.isArray(entry?.likes) ? entry.likes : [];
    const uid = user?._id?.toString?.() ?? '';
    const liked =
      !!uid && likes.some((l: any) => String(l?._id ?? l) === uid);
    return { liked, count: likes.length };
  };

  const getMatchLikeDisplay = (fid: string) => {
    const o = matchLikeOverride[fid];
    if (o) return o;
    return matchLikeFromServer(fid);
  };

  const handleFootballMatchLike = async (fid: string) => {
    if (!user) return;
    const cur = matchLikeOverride[fid] ?? matchLikeFromServer(fid);
    setMatchLikeOverride((prev) => ({
      ...prev,
      [fid]: {
        liked: !cur.liked,
        count: Math.max(0, cur.count + (cur.liked ? -1 : 1)),
      },
    }));
    setFootballMatchLikingId(fid);
    try {
      const data: any = await apiService.put(`${ENDPOINTS.LIKE_POST}/${post._id}`, {
        footballMatchId: fid,
      });
      if (Array.isArray(data?.footballMatchLikes)) {
        updatePost(post._id, { footballMatchLikes: data.footballMatchLikes } as any);
        onPostUpdated?.((prev: any) =>
          prev ? { ...prev, footballMatchLikes: data.footballMatchLikes } : prev,
        );
      }
      setMatchLikeOverride((prev) => {
        const n = { ...prev };
        delete n[fid];
        return n;
      });
    } catch (error: any) {
      console.error('Error liking match:', error);
      setMatchLikeOverride((prev) => {
        const n = { ...prev };
        delete n[fid];
        return n;
      });
      showToast('Error', error?.message || 'Failed to like', 'error');
    } finally {
      setFootballMatchLikingId((x) => (x === fid ? null : x));
    }
  };

  const handleDelete = () => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setIsDeleting(true);
            try {
              await apiService.delete(`${ENDPOINTS.DELETE_POST}/${post._id}`);
              deletePostContext(post._id);
              onPostDeleted?.(String(post._id));
              showToast('Success', 'Post deleted', 'success');
            } catch (error: any) {
              console.error('Error deleting post:', error);
              showToast('Error', 'Failed to delete post', 'error');
            } finally {
              setIsDeleting(false);
            }
          },
        },
      ]
    );
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  // Extract YouTube video ID from many possible URL shapes:
  // embed, watch?v=, youtu.be, shorts, live, and thumbnail /vi/<id>/...
  const getYouTubeVideoId = (url: string) => {
    if (!url) return '';
    const normalized = url.trim();
    const patterns = [
      /youtube\.com\/embed\/([^?&/]+)/i,
      /youtube\.com\/watch\?v=([^?&/]+)/i,
      /youtu\.be\/([^?&/]+)/i,
      /youtube\.com\/shorts\/([^?&/]+)/i,
      /youtube\.com\/live\/([^?&/]+)/i,
      /(?:ytimg\.com|img\.youtube\.com)\/vi\/([^?&/]+)/i,
    ];
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match?.[1]) return match[1];
    }
    return '';
  };

  const youtubeVideoId = getYouTubeVideoId(post.img || '');
  const isYouTubePost = !!youtubeVideoId;

  // Check if this is a channel post (system account with YouTube or channel post)
  const channelUsernames = ['Football', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 'SkyNews', 'Cartoonito', 
    'NatGeoKids', 'SciShowKids', 'JJAnimalTime', 'KidsArabic', 'NatGeoAnimals', 'MBCDrama', 'Fox11'];
  const isChannelPost = isYouTubePost || !!post?.channelAddedBy || 
    channelUsernames.includes(post.postedBy?.username);

  /** Chess/card posts are removed when the game ends — hide feed actions to avoid broken like/comment/remind. */
  const hideGamePostFooter = isChessPost || isCardPost;

  const isMyChannelFeedCard =
    !!post?.channelAddedBy && String(post.channelAddedBy) === String(user?._id);

  const canHideRegularUserPost =
    showFeedExtras &&
    !!user &&
    !isOwner &&
    !isChannelPost &&
    !isFootballPost &&
    !isWeatherPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive &&
    !!post?._id &&
    /^[0-9a-fA-F]{24}$/.test(String(post._id));

  /** Feed ⋮ menu: regular posts, Weather, or channels you added. No Football / system channels / games / live / own posts. */
  const showFeedPostMenu =
    showFeedExtras &&
    !!user &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive &&
    !isFootballPost &&
    !isOwner &&
    (canHideRegularUserPost || isWeatherPost || isMyChannelFeedCard);

  const hideRegularPostFromFeed = () => {
    const isSelfContributor =
      !!post.isCollaborative && !!isContributor && !isOwner && !!currentUserId;

    if (isSelfContributor) {
      Alert.alert(t('leaveCollaborativePost'), t('leaveCollaborativePostHint'), [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('leaveCollaborativePostConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              const data: any = await apiService.delete(
                `${ENDPOINTS.REMOVE_CONTRIBUTOR}/${String(post._id)}/contributor/${currentUserId}`,
              );
              deletePostContext(String(post._id));
              onPostDeleted?.(String(post._id));
              if (data?.hiddenPostId) {
                addHiddenFeedPostId(String(data.hiddenPostId));
              }
              showToast(t('success'), t('contributorRemoved'), 'success');
            } catch (e: any) {
              showToast(t('error'), e?.message || t('failedToRemoveContributor'), 'error');
            }
          },
        },
      ]);
      return;
    }

    Alert.alert(t('notInterested'), t('notInterestedHint'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('notInterestedConfirm'),
        onPress: async () => {
          try {
            await hideFeedPostFromFeed(String(post._id));
            showToast(t('success'), t('removedFromFeed'), 'success');
          } catch (e: any) {
            showToast(t('error'), e?.message || 'Failed', 'error');
          }
        },
      },
    ]);
  };

  const hideChannelOrWeatherFromFeed = () => {
    Alert.alert(
      t('removeFromFeed'),
      t('removeFromFeedHint'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('removeFromFeedConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              // Channels you add are real DB posts scoped to you (`channelAddedBy`).
              // Deleting them server-side prevents them from "coming back" when you follow Football/refresh feed.
              if (isMyChannelFeedCard && post?._id) {
                await apiService.delete(`${ENDPOINTS.DELETE_POST}/${String(post._id)}`);
                deletePostContext(String(post._id));
                onPostDeleted?.(String(post._id));
              } else {
                // Football/Weather cards are global/system posts; hide only.
                const uname = post?.postedBy?.username;
                if (uname === 'Football' || uname === 'Weather') {
                  hideFeedSourceFromFeed(String(uname));
                } else {
                  await hideFeedPostFromFeed(String(post._id));
                }
              }
              showToast(t('success'), t('removedFromFeed'), 'success');
            } catch (e: any) {
              showToast(t('error'), e?.message || 'Failed', 'error');
            }
          },
        },
      ]
    );
  };

  const handleFeedPostMenuPress = () => {
    if (isWeatherPost || isMyChannelFeedCard) {
      hideChannelOrWeatherFromFeed();
      return;
    }
    if (canHideRegularUserPost) {
      hideRegularPostFromFeed();
    }
  };

  const canEditPostText =
    !!user &&
    !isChannelPost &&
    !isWeatherPost &&
    !isFootballPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.channelAddedBy &&
    (isOwner || (!!post.isCollaborative && isContributor));

  const canMessagePostOwner =
    showFeedExtras &&
    !!user &&
    !isOwner &&
    !isChannelPost &&
    !isFootballPost &&
    !isWeatherPost &&
    !isChessPost &&
    !isCardPost &&
    !post?.isLive &&
    !!postedById &&
    /^[0-9a-fA-F]{24}$/.test(postedById);

  const onMessagePostOwner = useCallback(() => {
    if (!canMessagePostOwner) return;
    const author =
      typeof post.postedBy === 'object' && post.postedBy ? post.postedBy : null;
    navigateToMainStack(navigation, 'ChatScreen', {
      userId: postedById,
      otherUser: {
        _id: postedById,
        name: author?.name || author?.username || 'User',
        username: author?.username,
        profilePic: author?.profilePic,
      },
    });
  }, [canMessagePostOwner, navigation, post.postedBy, postedById]);
  
  // Check if post has regular video (mp4, webm, etc.)
  const isVideoPost = post.img && (
    post.img.match(/\.(mp4|webm|ogg|mov)$/i) || 
    post.img.includes('/video/upload/')
  );
  const isAnimatedImagePost = isAnimatedImageUrl(String(post.img || ''));
  const canPreviewPostImage =
    !!post.img && disableNavigation && !isYouTubePost && !isVideoPost;
  const postImagePreviewUrl = String(post.img || '');
  const displayImageUrl = mediaDisplayUrl(String(post.img || ''));
  const displayVideoUrl = mediaDisplayUrl(String(post.img || ''));
  const thumbnailVideoUrl = String(post.img || '');
  const serverVideoThumbnail =
    post.thumbnail || post.videoThumbnail || post.thumb || post.thumbnailUrl || null;
  const feedAutoPlaySource = useMemo(
    () => ({
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
            <style>${INLINE_VIDEO_CONTAIN_CSS}</style>
          </head>
          <body>
            <video id="v"
              src="${displayVideoUrl}"
              autoplay
              loop
              playsinline
              webkit-playsinline
              preload="auto"
              poster="${post.thumbnail || ''}"
              muted
            ></video>
            <script>
              (function () {
                var v = document.getElementById('v');
                if (!v) return;
                function send(name) {
                  window.ReactNativeWebView && window.ReactNativeWebView.postMessage(name);
                }
                v.addEventListener('playing', function(){ send('playing'); });
                v.addEventListener('pause', function(){ send('paused'); });
                v.addEventListener('canplay', function(){ send('canplay'); });
                v.addEventListener('loadeddata', function(){ send('loadeddata'); });
                v.addEventListener('error', function(){ send('error'); });
                v.addEventListener('timeupdate', function(){ send('time:' + String(v.currentTime || 0)); });
                var p = v.play();
                if (p && p.catch) p.catch(function(){ send('play-blocked'); });
              })();
            </script>
          </body>
        </html>
      `,
    }),
    [displayVideoUrl, post.thumbnail]
  );

  const { width } = Dimensions.get('window');

  const showStoryRing =
    !!storyRing?.storyId &&
    !!postedById &&
    !isChannelPost &&
    !isWeatherPost &&
    !isFootballPost &&
    !isChessPost &&
    !isCardPost;

  /** Feed-only: hide avatar / name / @Football row so cards match Football tab; Post detail keeps header. */
  const hideFootballFeedHeader = isFootballPost && !disableNavigation;

  const feedCard = useFeedCardMetrics();
  const useFeedWideLayout = !!(feedWideCard && !fullWidthCard && !hideFootballFeedHeader);
  const feedMediaHeight = useFeedWideLayout ? feedCard.mediaHeight : (width - 30) * 0.5625;
  const feedWideContainerStyle = useFeedWideLayout
    ? {
        marginHorizontal: 0,
        marginVertical: feedCard.cardMarginV,
        padding: feedCard.cardPadding,
        borderRadius: feedCard.cardRadius,
        overflow: 'hidden' as const,
        borderWidth: 1,
      }
    : null;
  const feedAvatarStyle = useFeedWideLayout
    ? {
        width: feedCard.headerAvatar,
        height: feedCard.headerAvatar,
        borderRadius: feedCard.headerAvatar / 2,
        marginRight: Math.round(10 * feedCard.scale),
      }
    : null;
  /** Full card width like live — contain inside (no zoom/crop). */
  const feedMediaBleedStyle = useFeedWideLayout
    ? {
        width: feedCard.screenWidth,
        marginHorizontal: feedCard.bleedMargin,
        height: feedMediaHeight,
        borderRadius: 0,
        overflow: 'hidden' as const,
      }
    : null;
  const postImageStyle = useFeedWideLayout
    ? [styles.postImage, feedMediaBleedStyle]
    : styles.postImage;
  const videoContainerStyle = useFeedWideLayout
    ? [styles.videoContainer, feedMediaBleedStyle]
    : [styles.videoContainer, { height: feedMediaHeight }];

  const onAvatarPress = (e: any) => {
    e.stopPropagation();
    if (disableNavigation) return;

    const username =
      typeof post.postedBy === 'object' && post.postedBy?.username
        ? String(post.postedBy.username).trim()
        : '';

    if (isFootballPost) {
      navigateToFootballTab();
      return;
    }
    if (isChannelPost && post?._id) {
      navigateToPostDetail(post._id);
      return;
    }
    if (!username) return;

    if (showStoryRing && storyRing?.storyId && postedById) {
      setStoryMenu({ userId: postedById, username });
      return;
    }

    navigateToUserProfile(username);
  };

  const onContributorPress = (contributor: any, contributorId?: string) => {
    const cObj = typeof contributor === 'object' ? contributor : null;
    const cid = contributorId || (cObj?._id || contributor)?.toString?.();
    const hydrated = cid && contribHydrateMap[cid] ? contribHydrateMap[cid] : null;
    const profile = hydrated || cObj;
    const username = profile?.username ? String(profile.username).trim() : '';
    const query = username || cid;
    if (!query) return;

    navigateToUserProfile(query);
  };

  return (
    <View
      style={[
        styles.container,
        fullWidthCard && styles.containerFullWidth,
        useFeedWideLayout && feedWideContainerStyle,
        useFeedWideLayout && { borderColor: colors.border },
        /* Football channel on feed: same as Football Live — card on `background`, not a second grey plate. */
        {
          backgroundColor:
            hideFootballFeedHeader && !disableNavigation ? colors.background : colors.backgroundLight,
        },
        showStackedFootballMatchActions && { paddingBottom: 0 },
        /* Align match cards with Football tab list (`padding: 15` there = 15px inset here). */
        hideFootballFeedHeader && !disableNavigation && styles.containerFootballFeedCompact,
        hideFootballFeedHeader && styles.containerFootballFeedFlatShell,
      ]}
    >
      {!hideFootballFeedHeader && (
      <View style={styles.header}>
        <View style={styles.headerAvatarWrap}>
        <StoryAvatarRing
          visible={showStoryRing}
          showAnimatedRedFill={!!storyRing?.storyId && !!storyRing?.hasUnviewed}
          replayKey={storyRingReplayKey}
          ringOuterSize={useFeedWideLayout ? feedCard.storyRingOuter : 50}
          avatarSize={useFeedWideLayout ? feedCard.headerAvatar : 45}
          strokeWidth={2}
        >
          <TouchableOpacity
            onPress={onAvatarPress}
            activeOpacity={disableNavigation ? 1 : 0.7}
            disabled={disableNavigation}
          >
          {(() => {
            // Use current user's profilePic if it's own post (for immediate updates)
            const avatarPic = isOwner && user?.profilePic 
              ? user.profilePic 
              : (post.postedBy?.profilePic && !isChannelPost ? post.postedBy.profilePic : null);
            
            return avatarPic ? (
              <SafeImage 
                source={{ uri: avatarPic }} 
                style={[styles.avatar, feedAvatarStyle]}
              />
            ) : (
              <View style={[styles.avatar, feedAvatarStyle, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                <Text style={styles.avatarText}>
                  {(() => {
                    // For channels, use first two letters of username or name
                    const name = post.postedBy?.name || post.postedBy?.username || '';
                    if (isChannelPost && name.length >= 2) {
                      return name.substring(0, 2).toUpperCase();
                    }
                    // For regular users, use first letter
                    return name[0]?.toUpperCase() || '?';
                  })()}
                </Text>
              </View>
            );
          })()}
        </TouchableOpacity>
        </StoryAvatarRing>
        {showAuthorPresenceDot && (
          <View
            style={[
              styles.authorOnlineDot,
              {
                backgroundColor: authorIsOnline ? colors.success : colors.textGray,
                borderColor: colors.background,
              },
            ]}
            accessibilityLabel={authorIsOnline ? t('online') : t('offline')}
          />
        )}
        </View>

        {isFootballPost && !disableNavigation ? (
          <TouchableOpacity
            style={styles.headerInfo}
            activeOpacity={0.7}
            onPress={(e) => {
              e.stopPropagation();
              navigateToFootballTab();
            }}
            accessibilityRole="button"
            accessibilityLabel="Football Live"
          >
            <View style={styles.headerTop}>
              <Text style={[styles.name, { color: colors.text }]}>{post.postedBy?.name || 'Unknown'}</Text>
              {post.isCollaborative && (
                <Text style={styles.collaborativeBadge}>👥</Text>
              )}
              <View style={styles.timeMetaRow}>
                <Text style={[styles.time, styles.timeLtr, { color: colors.textGray }]}>
                  {`· ${formatTime(post.createdAt)}`}
                </Text>
                {post.editedAt ? (
                  <Text
                    style={[
                      styles.time,
                      styles.timeLtr,
                      { color: colors.textGray },
                      isRTL ? styles.timeEditedRtl : null,
                    ]}
                  >
                    {` · ${t('editedPost')}`}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={[styles.username, { color: colors.textGray }]}>@{post.postedBy?.username}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerInfo}>
            <View style={styles.headerTop}>
              <Text style={[styles.name, { color: colors.text }]}>{post.postedBy?.name || 'Unknown'}</Text>
              {post.isCollaborative && (
                <Text style={styles.collaborativeBadge}>👥</Text>
              )}
              <View style={styles.timeMetaRow}>
                <Text style={[styles.time, styles.timeLtr, { color: colors.textGray }]}>
                  {`· ${formatTime(post.createdAt)}`}
                </Text>
                {post.editedAt ? (
                  <Text
                    style={[
                      styles.time,
                      styles.timeLtr,
                      { color: colors.textGray },
                      isRTL ? styles.timeEditedRtl : null,
                    ]}
                  >
                    {` · ${t('editedPost')}`}
                  </Text>
                ) : null}
              </View>
            </View>
            <Text style={[styles.username, { color: colors.textGray }]}>@{post.postedBy?.username}</Text>
          </View>
        )}

        <View style={styles.headerActions}>
          {canMessagePostOwner && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                onMessagePostOwner();
              }}
              style={styles.headerMessageBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Message ${post.postedBy?.name || post.postedBy?.username || ''}`}
            >
              <Text style={[styles.headerMessageIcon, { color: colors.primary }]}>✉</Text>
            </TouchableOpacity>
          )}
          {showFeedPostMenu && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                handleFeedPostMenuPress();
              }}
              style={styles.headerMenuBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel={
                isWeatherPost || isMyChannelFeedCard
                  ? t('removeFromFeed')
                  : !!post.isCollaborative && !!isContributor && !isOwner
                    ? t('leaveCollaborativePost')
                    : t('notInterested')
              }
            >
              <Text style={[styles.headerMenuIcon, { color: colors.textGray }]}>⋮</Text>
            </TouchableOpacity>
          )}
          {canEditPostText && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                setEditPostOpen(true);
              }}
              style={{ padding: 5, marginRight: 4 }}
            >
              <Text style={styles.editButton}>✏️</Text>
            </TouchableOpacity>
          )}
          {isOwner && (
            <TouchableOpacity onPress={handleDelete} disabled={isDeleting}>
              <Text style={styles.deleteButton}>🗑️</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      )}

      {post.isCollaborative &&
        Array.isArray(post.contributors) &&
        post.contributors.length > 0 &&
        (() => {
          const ownerId = postedById;
          const displayContributors = post.contributors.filter((c: any) => {
            const cid = (typeof c === 'string' ? c : c?._id)?.toString?.();
            return cid && cid !== ownerId;
          });
          if (displayContributors.length === 0) return null;
          return (
            <View style={{ marginBottom: 10 }}>
              <Text style={[styles.contributorsLabel, { color: colors.textGray }]}>{t('contributors')}</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ marginTop: 6 }}
                contentContainerStyle={{ alignItems: 'center' }}
              >
                {displayContributors.map((contributor: any, idx: number) => {
                  const cid = (contributor?._id || contributor)?.toString();
                  const hydrated = cid && contribHydrateMap[cid] ? contribHydrateMap[cid] : null;
                  const cObj = hydrated || contributor;
                  const label = cObj?.name || cObj?.username || '?';
                  return (
                    <TouchableOpacity
                      key={cid || String(idx)}
                      style={{ marginRight: 8 }}
                      activeOpacity={0.75}
                      onPress={(e) => {
                        e.stopPropagation();
                        onContributorPress(cObj, cid);
                      }}
                    >
                      {cObj?.profilePic ? (
                        <SafeImage source={{ uri: cObj.profilePic }} style={styles.contribAvatar} />
                      ) : (
                        <View
                          style={[
                            styles.contribAvatar,
                            {
                              backgroundColor: colors.avatarBg,
                              justifyContent: 'center',
                              alignItems: 'center',
                            },
                          ]}
                        >
                          <Text style={{ color: '#fff', fontWeight: '700' }}>{label[0]?.toUpperCase()}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          );
        })()}

      {canAddCollaborator && (
        <View style={styles.collabActions}>
          <TouchableOpacity
            style={{ marginRight: 16 }}
            onPress={(e) => {
              e.stopPropagation();
              setAddContribOpen(true);
            }}
          >
            <Text style={[styles.collabActionText, { color: colors.primary }]}>+ {t('addContributor')}</Text>
          </TouchableOpacity>
          {canManageContributorsList && (
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation();
                setManageContribOpen(true);
              }}
            >
              <Text style={[styles.collabActionText, { color: colors.text }]}>{t('manageContributors')}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Hide post text for football posts if we have matches (from API or post data) */}
      {!(isFootballPost && (footballMatches.length > 0 || post.liveMatches?.length > 0 || post.matches?.length > 0 || post.todayMatches?.length > 0)) && (
        disableNavigation ? (
          <Text style={[styles.text, { color: colors.text }]}>{post.text}</Text>
        ) : isCardPost ? (
          <Text style={[styles.text, { color: colors.text }]}>{post.text}</Text>
        ) : isChessPost ? (
          <Pressable onPress={openGamePostDetails} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
            <Text style={[styles.text, { color: colors.text }]}>{post.text}</Text>
          </Pressable>
        ) : (
          <TouchableOpacity
            onPress={() => navigateToPostDetail(String(post._id))}
            activeOpacity={0.9}
          >
            <Text style={[styles.text, { color: colors.text }]}>{post.text}</Text>
          </TouchableOpacity>
        )
      )}

      {post.img && isYouTubePost && youtubeVideoId ? (
        disableNavigation ? (
          autoPlayMedia ? (
          <View style={videoContainerStyle}>
            <YoutubePlayer
            height={feedMediaHeight}
            videoId={youtubeVideoId}
            play={youtubePlaying}
            mute={false}
            webViewProps={{
              allowsInlineMediaPlayback: true,
              androidLayerType: 'hardware',
            }}
            initialPlayerParams={{
              controls: true,
              modestbranding: true,
              rel: false,
              autoplay: 1,
              mute: 0,
            }}
            onError={(error: unknown) => {
              console.error('❌ [Post] YouTube player error:', error);
            }}
            onReady={() => {
              setYoutubePlaying(true);
            }}
            onChangeState={(state: string) => {
              // Update state based on player state
              if (state === 'playing') {
                setYoutubePlaying(true);
              } else if (state === 'paused') {
                setYoutubePlaying(false);
              }
            }}
          />
          </View>
          ) : (
            <View style={videoContainerStyle}>
              <SafeImage
                source={{ uri: `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` }}
                style={styles.youtubeThumbnail}
                resizeMode="cover"
              />
              <View style={styles.youtubeOverlay} pointerEvents="none">
                <View style={styles.youtubePlayButton}>
                  <Text style={styles.youtubePlayIcon}>▶</Text>
                </View>
              </View>
            </View>
          )
        ) : (
          // FEED OPTIMIZATION: render a lightweight thumbnail instead of mounting YoutubePlayer in a scrolling list
          <TouchableOpacity
            onPress={() => navigateToPostDetail(post._id)}
            activeOpacity={0.9}
          >
            <View style={videoContainerStyle}>
              <SafeImage
                source={{ uri: `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` }}
                style={styles.youtubeThumbnail}
                resizeMode="cover"
              />
              <View style={styles.youtubeOverlay}>
                <View style={styles.youtubePlayButton}>
                  <Text style={styles.youtubePlayIcon}>▶</Text>
                </View>
                <Text style={styles.youtubeWatchText}>Tap to watch</Text>
              </View>
            </View>
          </TouchableOpacity>
        )
      ) : post.img && isVideoPost ? (
        disableNavigation ? (
          autoPlayMedia ? (
          <View style={videoContainerStyle}>
            <WebView
            ref={detailVideoWebViewRef}
            source={{
              html: `
                <!DOCTYPE html>
                <html>
                  <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
                    <style>
                      ${INLINE_VIDEO_CONTAIN_CSS}
                      body { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
                    </style>
                  </head>
                  <body>
                    <video
                      src="${displayVideoUrl}"
                      controls
                      ${autoPlayMedia ? 'autoplay' : ''}
                      ${autoPlayMedia ? '' : 'muted'}
                      playsinline
                      preload="auto"
                      controlsList="nodownload"
                    ></video>
                    <script>
                      (function () {
                        var v = document.querySelector('video');
                        if (!v) return;
                        function tryPlay() {
                          var p = v.play();
                          if (p && p.catch) p.catch(function(){});
                        }
                        ${autoPlayMedia ? 'tryPlay();' : ''}
                        v.addEventListener('loadeddata', function () {
                          ${autoPlayMedia ? 'tryPlay();' : ''}
                        });
                        v.addEventListener('canplay', function () {
                          ${autoPlayMedia ? 'tryPlay();' : ''}
                        });
                      })();
                    </script>
                  </body>
                </html>
              `
            }}
            style={styles.videoWebView}
            allowsFullscreenVideo={true}
            mediaPlaybackRequiresUserAction={!(disableNavigation && autoPlayMedia)}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowsInlineMediaPlayback={true}
            mixedContentMode="always"
            startInLoadingState={true}
            originWhitelist={['*']}
            onLoadEnd={() => {
              if (!autoPlayMediaRef.current) {
                pauseDetailVideo();
                return;
              }
              // Force immediate play after WebView is ready (only while Post Detail is focused).
              detailVideoWebViewRef.current?.injectJavaScript(`
                (function () {
                  var v = document.querySelector('video');
                  if (!v) return;
                  var p = v.play();
                  if (p && p.catch) p.catch(function(){});
                })();
                true;
              `);
            }}
            renderLoading={() => (
              <View style={styles.videoLoading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            )}
            onError={(syntheticEvent) => {
              const { nativeEvent } = syntheticEvent;
              console.error('❌ [Post] WebView video error:', nativeEvent);
            }}
            onHttpError={(syntheticEvent) => {
              const { nativeEvent } = syntheticEvent;
              console.error('❌ [Post] WebView video HTTP error:', nativeEvent);
            }}
          />
          </View>
          ) : (
            <View style={videoContainerStyle}>
              <VideoFeedPreview
                videoUrl={thumbnailVideoUrl}
                serverThumbnail={serverVideoThumbnail}
                preferredTimeMs={feedVideoPreviewTimeMs}
                placeholderColor={colors.background}
                spinnerColor={colors.primary}
              />
              <View style={styles.feedPreviewOverlay} pointerEvents="none">
                <View style={styles.feedPreviewPlayButton}>
                  <Text style={styles.feedPreviewPlayIcon}>▶</Text>
                </View>
              </View>
            </View>
          )
        ) : (
          autoPlayMedia && !feedVideoErrored ? (
            <View style={videoContainerStyle}>
              {(!feedVideoReady || !isFeedVideoPlaying || isFeedVideoPausedByUser) && (
                <View style={styles.feedVideoPreviewOverlay}>
                  <VideoFeedPreview
                    videoUrl={thumbnailVideoUrl}
                    serverThumbnail={serverVideoThumbnail}
                    preferredTimeMs={feedVideoPreviewTimeMs}
                    placeholderColor={colors.background}
                    spinnerColor={colors.primary}
                  />
                  {!isFeedVideoPlaying && (
                    <View style={styles.feedPreviewOverlay}>
                      <TouchableOpacity
                        style={styles.feedPreviewPlayButton}
                        onPress={resumeFeedVideo}
                        activeOpacity={0.85}
                      >
                        <Text style={styles.feedPreviewPlayIcon}>▶</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              )}
              <WebView
                ref={feedVideoWebViewRef}
                source={feedAutoPlaySource}
                style={styles.videoWebView}
                allowsFullscreenVideo={false}
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mixedContentMode="always"
                originWhitelist={['*']}
                onLoadStart={() => setFeedVideoReady(false)}
                onLoadEnd={() => {
                  feedVideoWebViewRef.current?.injectJavaScript(`
                    (function () {
                      var v = document.getElementById('v');
                      if (!v) return;
                      if (${lastFeedVideoTimeRef.current.toFixed(3)} > 0 && Math.abs(v.currentTime - ${lastFeedVideoTimeRef.current.toFixed(3)}) > 0.35) {
                        try { v.currentTime = ${lastFeedVideoTimeRef.current.toFixed(3)}; } catch (_) {}
                      }
                      v.muted = ${isFeedVideoMuted ? 'true' : 'false'};
                      ${isFeedVideoPausedByUser ? 'v.pause();' : 'var p = v.play(); if (p && p.catch) p.catch(function(){});'}
                    })();
                    true;
                  `);
                }}
                onMessage={(event) => {
                  const msg = String(event?.nativeEvent?.data || '');
                  if (msg.startsWith('time:')) {
                    const sec = Number(msg.slice(5));
                    if (Number.isFinite(sec) && sec >= 0) {
                      lastFeedVideoTimeRef.current = sec;
                      const now = Date.now();
                      if (now - lastFeedVideoTimeUpdateRef.current > 700) {
                        lastFeedVideoTimeUpdateRef.current = now;
                        setFeedVideoPreviewTimeMs(Math.max(1000, Math.floor(sec * 1000)));
                      }
                    }
                    return;
                  }
                  if (msg === 'playing' || msg === 'canplay' || msg === 'loadeddata') {
                    setFeedVideoReady(true);
                    if (msg === 'playing') setIsFeedVideoPlaying(true);
                    return;
                  }
                  if (msg === 'paused') {
                    setFeedVideoReady(true);
                    setIsFeedVideoPlaying(false);
                    return;
                  }
                  if (msg === 'error') {
                    setFeedVideoReady(false);
                    setIsFeedVideoPlaying(false);
                    setFeedVideoErrored(true);
                  }
                }}
                onError={() => {
                  setFeedVideoReady(false);
                  setIsFeedVideoPlaying(false);
                  setFeedVideoErrored(true);
                }}
                onHttpError={() => {
                  setFeedVideoReady(false);
                  setIsFeedVideoPlaying(false);
                  setFeedVideoErrored(true);
                }}
              />
              <TouchableOpacity
                style={styles.feedPlayPauseButton}
                onPress={() => {
                  const nextPaused = !isFeedVideoPausedByUser;
                  setIsFeedVideoPausedByUser(nextPaused);
                  setIsFeedVideoPlaying(!nextPaused);
                  setFeedVideoPreviewTimeMs(Math.max(1000, Math.floor(lastFeedVideoTimeRef.current * 1000)));
                  feedVideoWebViewRef.current?.injectJavaScript(`
                    (function () {
                      var v = document.getElementById('v');
                      if (!v) return;
                      if (${nextPaused ? 'true' : 'false'}) {
                        v.pause();
                      } else {
                        var p = v.play();
                        if (p && p.catch) p.catch(function(){});
                      }
                    })();
                    true;
                  `);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.feedPlayPauseButtonText}>{!isFeedVideoPlaying ? '▶' : '⏸'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.feedMuteButton}
                onPress={() => {
                  const nextMuted = !isFeedVideoMuted;
                  setIsFeedVideoMuted(nextMuted);
                  feedVideoWebViewRef.current?.injectJavaScript(`
                    (function () {
                      var v = document.getElementById('v');
                      if (v) v.muted = ${nextMuted ? 'true' : 'false'};
                    })();
                    true;
                  `);
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.feedMuteButtonText}>{isFeedVideoMuted ? '🔇' : '🔊'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            // Keep lightweight preview for off-screen posts.
            <TouchableOpacity onPress={() => navigateToPostDetail(post._id)} activeOpacity={0.9}>
              <View style={videoContainerStyle}>
                <VideoFeedPreview
                  videoUrl={thumbnailVideoUrl}
                  serverThumbnail={serverVideoThumbnail}
                  preferredTimeMs={feedVideoPreviewTimeMs}
                  placeholderColor={colors.background}
                  spinnerColor={colors.primary}
                />
                <View style={styles.feedPreviewOverlay} pointerEvents="none">
                  <View style={styles.feedPreviewPlayButton}>
                    <Text style={styles.feedPreviewPlayIcon}>▶</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )
        )
      ) : post.img ? (
        disableNavigation ? (
          <>
            <TouchableOpacity
              activeOpacity={0.95}
              onPress={() => canPreviewPostImage && setPostImagePreviewOpen(true)}
              disabled={!canPreviewPostImage}
              accessibilityRole="button"
              accessibilityLabel={t('viewFullImage')}
            >
              <SafeImage
                source={{ uri: displayImageUrl }}
                style={postImageStyle}
                resizeMode="contain"
              />
              {canPreviewPostImage ? (
                <View style={styles.postImageExpandBtn} pointerEvents="none">
                  <Text style={styles.postImageExpandBtnText}>⛶</Text>
                </View>
              ) : null}
            </TouchableOpacity>
            <PinchZoomImageModal
              visible={postImagePreviewOpen && !!postImagePreviewUrl}
              uri={postImagePreviewUrl}
              onClose={() => setPostImagePreviewOpen(false)}
              closeAccessibilityLabel={t('close')}
            />
          </>
        ) : (
          <FeedPostImageZoom
            uri={displayImageUrl}
            containerStyle={postImageStyle}
            onPressImage={() => navigateToPostDetail(post._id)}
          />
        )
      ) : null}

      {isWeatherPost && (
        <View style={styles.weatherContainer}>
          {weatherLoading && weatherDataArray.length === 0 ? (
            <View style={styles.weatherLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
              <Text style={styles.weatherLoadingText}>Loading weather...</Text>
            </View>
          ) : weatherDataArray.length > 0 ? (
            weatherDataArray.map((weather: any, index: number) => (
              <View key={index} style={[styles.weatherCard, { backgroundColor: colors.cardBg }]}>
                <View style={styles.weatherHeader}>
                  <Text style={[styles.weatherCity, { color: colors.cardText }]}>
                    {weather.city}{weather.country ? `, ${weather.country}` : ''}
                  </Text>
                  <Text style={[styles.weatherTemp, { color: colors.cardText }]}>
                    {Math.round(weather.temperature)}°C
                  </Text>
                </View>
                <Text style={[styles.weatherDesc, { color: colors.cardText }]}>
                  {weather.description || weather.condition}
                </Text>
                <View style={styles.weatherDetails}>
                  <Text style={[styles.weatherDetail, { color: colors.cardText }]}>💧 {weather.humidity}%</Text>
                  <Text style={[styles.weatherDetail, { color: colors.cardText }]}>💨 {weather.windSpeed?.toFixed(1) || 0} m/s</Text>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.weatherEmpty}>
              <Text style={styles.weatherEmptyText}>No weather data available</Text>
              <Text style={styles.weatherEmptySubtext}>Select cities in Weather screen to see updates</Text>
            </View>
          )}
        </View>
      )}

      {isFootballPost && (
        <View
          style={[
            { marginBottom: showStackedFootballMatchActions ? 0 : 6 },
            /* No horizontal bleed — negative margin was clipping rounded cards on Android. */
          ]}
        >
          {/* Check if we have matches from API fetch or post data */}
          {footballLoading ? (
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', marginTop: 8 }]}>
                Loading matches...
              </Text>
            </View>
          ) : footballMatchesSource.length > 0 ? (
            footballLiveMatches.length > 0 ? (
              <View style={styles.footballFeedMatchListStrip}>
                {footballLiveMatchesDisplayed.map((match: any, index: number) => {
                  const fid =
                    match._id != null
                      ? String(match._id)
                      : match.fixture?.id != null
                        ? String(match.fixture.id)
                        : `idx-${index}`;
                  const matchLike = getMatchLikeDisplay(fid);
                  const stripLen = footballLiveMatchesDisplayed.length;
                  return (
                    <FootballMatchCard
                      key={fid}
                      match={match}
                      showStatus
                      lastInStrip={stripLen > 0 && index === stripLen - 1}
                      feedFooter={
                        <View style={styles.footballFeedUnitFooter} pointerEvents="box-none">
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              handleFootballMatchLike(fid);
                            }}
                            disabled={footballMatchLikingId === fid}
                          >
                            <Text style={styles.actionIcon}>{matchLike.liked ? '❤️' : '🤍'}</Text>
                            <Text style={[styles.actionText, { color: colors.textGray }]}>{matchLike.count}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.actionButton}
                            onPress={(e) => {
                              e.stopPropagation();
                              if (!disableNavigation) {
                                navigateToPostDetail(post._id, { footballMatchId: fid });
                              }
                            }}
                          >
                            <Text style={styles.actionIcon}>💬</Text>
                            <Text style={[styles.actionText, { color: colors.textGray }]}>
                              {footballMatchReplyCounts.get(fid) ?? 0}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      }
                    />
                  );
                })}
              </View>
            ) : (
              <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
                <Text style={[styles.footballTeam, { color: colors.cardText, textAlign: 'center' }]}>
                  ⚽ No live matches right now
                </Text>
                <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', fontSize: 12 }]}>
                  Check back during match hours
                </Text>
              </View>
            )
          ) : post.footballData ? (
            // Fallback to old single match format
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <Text style={[styles.footballTeam, { color: colors.cardText }]}>
                {post.footballData.homeTeam} vs {post.footballData.awayTeam}
              </Text>
              <Text style={[styles.footballScore, { color: colors.cardText }]}>
                {post.footballData.homeScore} - {post.footballData.awayScore}
              </Text>
              <Text style={[styles.footballStatus, { color: colors.cardText }]}>{post.footballData.status}</Text>
            </View>
          ) : (
            // No matches available (neither live nor upcoming)
            <View style={[styles.footballCard, { backgroundColor: colors.cardBg }]}>
              <Text style={[styles.footballTeam, { color: colors.cardText, textAlign: 'center' }]}>
                ⚽ No matches available
              </Text>
              <Text style={[styles.footballStatus, { color: colors.cardText, textAlign: 'center', fontSize: 12 }]}>
                Check back later for live updates
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Card Game Card Display */}
      {isCardPost && cardGameData && (
        <View
          style={[styles.chessCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
        >
          <View style={styles.chessCardHeader}>
            <View style={styles.chessCardTitle}>
              <Text style={styles.chessIcon}>🃏</Text>
              <View>
                <Text style={[styles.chessTitle, { color: colors.cardText }]}>Playing Go Fish</Text>
              </View>
            </View>
            {cardFeedEndedLocally ||
            !(cardGameData.gameStatus === 'active' || cardGameData.gameStatus == null) ? (
              <View style={[styles.chessLiveBadge, { backgroundColor: colors.textGray }]}>
                <Text style={styles.chessLiveText}>Ended</Text>
              </View>
            ) : (
              <View style={[styles.chessLiveBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.chessLiveText}>Live</Text>
              </View>
            )}
          </View>
          <View style={styles.chessPlayers}>
            <View style={styles.chessPlayer}>
              {cardGameData.player1?.profilePic ? (
                <SafeImage source={{ uri: cardGameData.player1.profilePic }} style={styles.chessPlayerAvatar} />
              ) : (
                <View style={[styles.chessPlayerAvatar, styles.chessPlayerAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                  <Text style={styles.chessPlayerAvatarText}>
                    {cardGameData.player1?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.chessPlayerName, { color: colors.cardText }]} numberOfLines={1}>
                {cardGameData.player1?.name || 'Player 1'}
              </Text>
            </View>
            <Text style={[styles.chessVs, { color: colors.cardText }]}>vs</Text>
            <View style={styles.chessPlayer}>
              {cardGameData.player2?.profilePic ? (
                <SafeImage source={{ uri: cardGameData.player2.profilePic }} style={styles.chessPlayerAvatar} />
              ) : (
                <View style={[styles.chessPlayerAvatar, styles.chessPlayerAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                  <Text style={styles.chessPlayerAvatarText}>
                    {cardGameData.player2?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.chessPlayerName, { color: colors.cardText }]} numberOfLines={1}>
                {cardGameData.player2?.name || 'Player 2'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Chess Game Card Display */}
      {isChessPost && chessGameData && (
        <TouchableOpacity
          style={[styles.chessCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={watchChessGame}
          activeOpacity={0.8}
        >
          <View style={styles.chessCardHeader}>
            <View style={styles.chessCardTitle}>
              <Text style={styles.chessIcon}>♟️</Text>
              <View>
                <Text style={[styles.chessTitle, { color: colors.cardText }]}>Playing Chess</Text>
                <Text style={[styles.chessSubtitle, { color: colors.cardText, opacity: 0.6 }]}>
                  Tap to watch
                </Text>
              </View>
            </View>
            {(chessFeedEndedLocally ||
              !(chessGameData.gameStatus === 'active' || chessGameData.gameStatus == null)) ? (
              <View style={[styles.chessLiveBadge, { backgroundColor: colors.textGray }]}>
                <Text style={styles.chessLiveText}>Ended</Text>
              </View>
            ) : (
              <View style={[styles.chessLiveBadge, { backgroundColor: colors.error }]}>
                <Text style={styles.chessLiveText}>Live</Text>
              </View>
            )}
          </View>
          
          <View style={styles.chessPlayers}>
            {/* Player 1 */}
            <View style={styles.chessPlayer}>
              {chessGameData.player1?.profilePic ? (
                <SafeImage
                  source={{ uri: chessGameData.player1.profilePic }}
                  style={styles.chessPlayerAvatar}
                />
              ) : (
                <View style={[styles.chessPlayerAvatar, styles.chessPlayerAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                  <Text style={styles.chessPlayerAvatarText}>
                    {chessGameData.player1?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.chessPlayerName, { color: colors.cardText }]} numberOfLines={1}>
                {chessGameData.player1?.name || 'Player 1'}
              </Text>
              <Text style={[styles.chessPlayerUsername, { color: colors.cardText, opacity: 0.6 }]} numberOfLines={1}>
                @{chessGameData.player1?.username || 'player1'}
              </Text>
            </View>

            <Text style={[styles.chessVs, { color: colors.cardText }]}>vs</Text>

            {/* Player 2 */}
            <View style={styles.chessPlayer}>
              {chessGameData.player2?.profilePic ? (
                <SafeImage
                  source={{ uri: chessGameData.player2.profilePic }}
                  style={styles.chessPlayerAvatar}
                />
              ) : (
                <View style={[styles.chessPlayerAvatar, styles.chessPlayerAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                  <Text style={styles.chessPlayerAvatarText}>
                    {chessGameData.player2?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={[styles.chessPlayerName, { color: colors.cardText }]} numberOfLines={1}>
                {chessGameData.player2?.name || 'Player 2'}
              </Text>
              <Text style={[styles.chessPlayerUsername, { color: colors.cardText, opacity: 0.6 }]} numberOfLines={1}>
                @{chessGameData.player2?.username || 'player2'}
              </Text>
            </View>
          </View>
        </TouchableOpacity>
      )}

      {!showStackedFootballMatchActions &&
        !hidePostFooterForFootballDetail &&
        !hideFootballFooterWhenNoMatchEmpty &&
        !hideGamePostFooter && (
        <View style={styles.footer} pointerEvents="box-none">
          <TouchableOpacity
            style={styles.actionButton}
            onPress={(e) => {
              e.stopPropagation();
              handleLike();
            }}
            disabled={isLiking}
          >
            <Text style={styles.actionIcon}>{isLiked ? '❤️' : '🤍'}</Text>
            <Text style={[styles.actionText, { color: colors.textGray }]}>{localLikesCount}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionButton}
            onPress={(e) => {
              e.stopPropagation();
              if (!disableNavigation) {
                navigateToPostDetail(post._id);
              }
            }}
          >
            <Text style={styles.actionIcon}>💬</Text>
            <Text style={[styles.actionText, { color: colors.textGray }]}>
              {(post as any).replyCount ?? post.replies?.length ?? 0}
            </Text>
          </TouchableOpacity>

          {showFeedExtras && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                openShareModal();
              }}
            >
              <Text style={styles.actionIcon}>📤</Text>
              <Text style={[styles.actionText, { color: colors.textGray }]}>Share</Text>
            </TouchableOpacity>
          )}

          {showFeedExtras && isCapsuleEligiblePost && (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={(e) => {
                e.stopPropagation();
                openCapsuleModal();
              }}
            >
              <Text style={styles.actionIcon}>{capsuleSealed ? '🔔' : '🕰️'}</Text>
              <Text style={[styles.actionText, { color: colors.textGray }]}>
                {capsuleSealed ? (capsuleSelectedLabel || 'Set') : 'Remind'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal
        visible={showFeedExtras && shareModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setShareModalVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Share to chat</Text>
            <Text style={[styles.modalSub, { color: colors.textGray }]} numberOfLines={1}>
              {permalink}
            </Text>
            {loadingConversations ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <FlatList
                data={conversations}
                keyExtractor={(item, idx) => String(item?._id || `conv-${idx}`)}
                style={{ maxHeight: 280 }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.modalRow, { borderColor: colors.border }]}
                    onPress={() => handleShareToConversation(item)}
                    disabled={!!sendingShareToId}
                  >
                    <Text style={{ color: colors.text }}>
                      {item?.isGroup ? '👥 ' : '💬 '}
                      {getConversationLabel(item)}
                    </Text>
                    {sendingShareToId === String(item?._id || '') ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : null}
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={[styles.modalSub, { color: colors.textGray }]}>No chats found</Text>
                }
              />
            )}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { borderColor: colors.border }]}
              onPress={() => setShareModalVisible(false)}
            >
              <Text style={{ color: colors.text }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showFeedExtras && capsuleModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCapsuleModalVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              {capsuleSealed ? 'Reminder set' : 'Remind me later'}
            </Text>
            <Text style={[styles.modalSub, { color: colors.textGray }]}>
              Choose when to be notified about this post.
            </Text>
            {[
              { label: '1 minute', value: '1m' },
              { label: '5 minutes', value: '5m' },
              { label: '1 hour', value: '1h' },
              { label: '3 days', value: '3d' },
            ].map(({ label, value }) => (
              <TouchableOpacity
                key={value}
                style={[styles.modalRow, { borderColor: colors.border }]}
                disabled={!!capsuleLoadingDuration || capsuleLoading}
                onPress={() => handleSealCapsule(value)}
              >
                <Text style={{ color: colors.text }}>⏳ {label}</Text>
                {capsuleLoadingDuration === value ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            ))}
            {capsuleSealed && (
              <TouchableOpacity
                style={[styles.modalDangerBtn, { borderColor: colors.error }]}
                disabled={capsuleLoading}
                onPress={handleUnsealCapsule}
              >
                <Text style={{ color: colors.error }}>Cancel reminder</Text>
                {capsuleLoading ? <ActivityIndicator size="small" color={colors.error} /> : null}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.modalCloseBtn, { borderColor: colors.border }]}
              onPress={() => setCapsuleModalVisible(false)}
            >
              <Text style={{ color: colors.text }}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AddContributorModal
        visible={addContribOpen}
        onClose={() => setAddContribOpen(false)}
        post={post}
        onContributorAdded={onCollaborativePostUpdated}
      />
      <ManageContributorsModal
        visible={manageContribOpen}
        onClose={() => setManageContribOpen(false)}
        post={post}
        onContributorRemoved={onCollaborativePostUpdated}
      />
      <EditPostModal
        visible={editPostOpen}
        onClose={() => setEditPostOpen(false)}
        post={post}
        onSaved={(updated) => {
          onCollaborativePostUpdated(updated);
        }}
      />
      <StoryOrProfileSheet
        visible={!!storyMenu}
        onClose={() => setStoryMenu(null)}
        username={storyMenu?.username}
        onSeeStory={() => {
          if (storyMenu?.userId) {
            navigateToMainStack(navigation, 'StoryViewer', { userId: storyMenu.userId });
          }
        }}
        onGoToProfile={
          storyMenu?.username
            ? () => navigateToUserProfile(storyMenu.username!)
            : undefined
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 15,
    marginHorizontal: 15,
    borderRadius: 8,
    backgroundColor: COLORS.background,
  },
  containerFullWidth: {
    marginHorizontal: 0,
    borderRadius: 0,
  },
  /**
   * Football feed: same horizontal inset as FootballScreen `listContainer` (padding 15) —
   * no extra inner padding so the match card width/position matches the second screen.
   */
  containerFootballFeedCompact: {
    marginHorizontal: 15,
    padding: 0,
    paddingTop: 6,
    paddingBottom: 4,
  },
  /** Square post container on football feed — match cards keep their own radius. */
  containerFootballFeedFlatShell: {
    borderRadius: 0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  headerAvatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    marginRight: 10,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 6,
    flexShrink: 0,
  },
  headerMessageBtn: {
    padding: 6,
    marginRight: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMessageIcon: {
    fontSize: 18,
    fontWeight: '600',
  },
  headerMenuBtn: {
    padding: 6,
    marginRight: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerMenuIcon: {
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 22,
  },
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  authorOnlineDot: {
    position: 'absolute',
    bottom: 1,
    left: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    zIndex: 2,
  },
  collaborativeBadge: {
    marginLeft: 5,
    fontSize: 14,
  },
  contribAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  collabActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
  },
  collabActionText: {
    fontSize: 14,
    fontWeight: '600',
  },
  contributorsLabel: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  time: {
    fontSize: 14,
    color: COLORS.textGray,
    marginLeft: 5,
  },
  timeLtr: {
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  timeEditedRtl: {
    marginLeft: 2,
  },
  username: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  deleteButton: {
    fontSize: 18,
    padding: 5,
  },
  editButton: {
    fontSize: 18,
    padding: 5,
  },
  text: {
    fontSize: 15,
    color: COLORS.text,
    lineHeight: 20,
    marginBottom: 10,
  },
  postImage: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: '#000',
  },
  postImageExpandBtn: {
    position: 'absolute',
    right: 10,
    bottom: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  postImageExpandBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 20,
  },
  videoContainer: {
    width: '100%',
    height: (Dimensions.get('window').width - 30) * 0.5625, // 16:9 aspect ratio
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    backgroundColor: '#000',
    position: 'relative',
  },
  videoWebView: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  youtubeThumbnail: {
    width: '100%',
    height: '100%',
  },
  youtubeOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  youtubePlayButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  youtubePlayIcon: {
    fontSize: 32,
    color: '#FFFFFF',
    marginLeft: 4, // Slight offset for play icon
  },
  youtubeWatchText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  videoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  feedMuteButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedPlayPauseButton: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedPlayPauseButtonText: {
    fontSize: 16,
    color: '#fff',
  },
  feedMuteButtonText: {
    fontSize: 16,
    color: '#fff',
  },
  feedVideoPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  feedPreviewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedPreviewPlayButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  feedPreviewPlayIcon: {
    fontSize: 24,
    color: '#fff',
    marginLeft: 2,
  },
  weatherContainer: {
    marginBottom: 10,
  },
  weatherCard: {
    backgroundColor: COLORS.backgroundLight,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  weatherHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  weatherCity: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
  },
  weatherTemp: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  weatherDesc: {
    fontSize: 14,
    color: COLORS.textGray,
    textTransform: 'capitalize',
    marginBottom: 8,
  },
  weatherDetails: {
    flexDirection: 'row',
    gap: 15,
  },
  weatherDetail: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  weatherLoading: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weatherLoadingText: {
    marginTop: 8,
    fontSize: 14,
    color: COLORS.textGray,
  },
  weatherEmpty: {
    padding: 20,
    alignItems: 'center',
  },
  weatherEmptyText: {
    fontSize: 14,
    color: COLORS.textGray,
    marginBottom: 4,
  },
  weatherEmptySubtext: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  footballCard: {
    backgroundColor: COLORS.backgroundLight,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  footballTeam: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  footballScore: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  footballStatus: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  /** Column only — spacing between cards is `marginBottom` on `FootballMatchCard` (same as Football tab). */
  footballFeedMatchListStrip: {
    flexDirection: 'column',
  },
  footballFeedUnitFooter: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 10,
    paddingHorizontal: 8,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    paddingTop: 10,
    gap: 10,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  actionIcon: {
    fontSize: 18,
  },
  actionText: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  modalCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
  },
  modalSub: {
    fontSize: 13,
    marginBottom: 10,
  },
  modalLoading: {
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRow: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalCloseBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  modalDangerBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
    marginBottom: 6,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  chessCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chessCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  chessCardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chessIcon: {
    fontSize: 32,
  },
  chessTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  chessSubtitle: {
    fontSize: 12,
    color: COLORS.textGray,
    marginTop: 2,
  },
  chessLiveBadge: {
    backgroundColor: COLORS.success,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  chessLiveText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  chessPlayers: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 16,
  },
  chessPlayer: {
    alignItems: 'center',
    flex: 1,
  },
  chessPlayerAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  chessPlayerAvatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chessPlayerAvatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  chessPlayerName: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 2,
  },
  chessPlayerUsername: {
    fontSize: 12,
    color: COLORS.textGray,
    textAlign: 'center',
  },
  chessVs: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
});

export default Post;
