import React, { useEffect, useState, useCallback, useRef } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { usePost } from '../../context/PostContext';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import { apiService } from '../../services/api';
import { ENDPOINTS, COLORS, STORY_STRIP_SHOULD_REFRESH } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import ChannelsModal from '../../components/ChannelsModal';
import ActivityModal from '../../components/ActivityModal';

interface AvailableUser {
  _id: string;
  name: string;
  username: string;
  profilePic?: string;
}

const FeedScreen = ({ navigation }: any) => {
  const { posts, setPosts, appendPosts, filterPostsForFeed, unhideFeedPostFromFeed, unhideFeedSourceFromFeed, setViewerSortBoost } = usePost();
  const { user, logout } = useUser();
  const { socket, isUserOnline, notificationCount } = useSocket();
  const { t, isRTL } = useLanguage();
  const { theme, toggleTheme, colors } = useTheme();
  const showToast = useShowToast();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showChessModal, setShowChessModal] = useState(false);
  const [showCardModal, setShowCardModal] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [incomingChallenge, setIncomingChallenge] = useState<any>(null);
  const [incomingCardChallenge, setIncomingCardChallenge] = useState<any>(null);
  const [busyChessUserIds, setBusyChessUserIds] = useState<string[]>([]);
  const [busyCardUserIds, setBusyCardUserIds] = useState<string[]>([]);
  const [showChannelsModal, setShowChannelsModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);
  /** userId -> story ring info for post avatars */
  const [storyByUserId, setStoryByUserId] = useState<
    Record<string, { storyId: string; hasUnviewed: boolean }>
  >({});
  /** Each feed focus: replay gray→red fill on all story rings */
  const [storyRingReplayKey, setStoryRingReplayKey] = useState(0);
  const isFetchingRef = useRef(false);
  const footballFollowBoostTsRef = useRef<number>(0);
  const weatherFollowBoostTsRef = useRef<number>(0);
  const lastLoadMoreTimeRef = useRef<number>(0);
  const feedSessionUserIdRef = useRef<string | undefined>(undefined);
  const LOAD_MORE_DEBOUNCE_MS = 2000;

  useEffect(() => {
    feedSessionUserIdRef.current = user?._id;
  }, [user?._id]);

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
      setStoryRingReplayKey((k) => k + 1);
      // Always refresh to get latest live matches and weather
      if (!loading && !isFetchingRef.current) {
        console.log('🔄 [FeedScreen] useFocusEffect: Refreshing feed for live updates');
        fetchFeed();
      }
      fetchStoryStrip();
      // fetchFeed is intentionally omitted from deps (same as before) to avoid re-registering every render
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchStoryStrip, loading])
  );

  useEffect(() => {
    fetchFeed();
  }, []);

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

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('FootballFollowedBoost', (payload: any) => {
      const ts = Number(payload?.ts || 0);
      footballFollowBoostTsRef.current = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('WeatherFollowedBoost', (payload: any) => {
      const ts = Number(payload?.ts || 0);
      weatherFollowBoostTsRef.current = Number.isFinite(ts) && ts > 0 ? ts : Date.now();
    });
    return () => sub.remove();
  }, []);

  // Socket listeners specific to FeedScreen UI
  // NOTE: post create/update/delete events are handled globally in SocketContext/PostContext
  useEffect(() => {
    if (!socket) return;

    const handleChessChallenge = (data: any) => {
      const me = user?._id?.toString?.();
      const target = data?.to?.toString?.();
      // Backend now sends `to`; older servers omit it — if we received the event, it was routed to us.
      if (target && me && target !== me) return;
      if (data?.from?.toString?.() === me) return;
      setIncomingChallenge(data);
      showToast('Chess Challenge!', `${data.fromName} challenged you to chess!`, 'info');
    };

    // acceptChessChallenge navigation is handled globally in AppNavigator so the
    // challenger opens the game even when not on the Feed tab (Messages, Search, etc.).

    const handleChessDeclined = (data: any) => {
      // Backend sends: { from } where 'from' is the user who declined (the opponent)
      console.log('♟️ [FeedScreen] Challenge declined by:', data.from);
      showToast('Challenge Declined', 'Your challenge was declined', 'info');
      // Remove the declined user from busy list so they appear available again
      if (data.from) {
        setBusyChessUserIds(prev => prev.filter(id => id?.toString() !== data.from?.toString()));
      }
    };

    const handleCardChallenge = (data: any) => {
      const me = user?._id?.toString?.();
      const target = data?.to?.toString?.();
      if (target && me && target !== me) return;
      if (data?.from?.toString?.() === me) return;
      setIncomingCardChallenge(data);
      showToast('Card Challenge!', `${data.fromName} challenged you to Go Fish!`, 'info');
    };

    // acceptCardChallenge navigation is handled globally in AppNavigator (same as chess).

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

    // Football real-time updates
    const handleFootballUpdate = (data: any) => {
      console.log('⚽ [FeedScreen] Football update received, refreshing feed silently...', data);
      // Silent refresh to get updated football posts (no clearing, just refresh)
      fetchFeed(false);
    };

    // Weather real-time updates
    const handleWeatherUpdate = (data: any) => {
      console.log('🌤️ [FeedScreen] Weather update received, refreshing feed silently...');
      // Silent refresh to get updated weather posts
      fetchFeed(false);
    };

    socket.on('chessChallenge', handleChessChallenge);
    socket.on('chessDeclined', handleChessDeclined);
    socket.on('cardChallenge', handleCardChallenge);
    socket.on('cardDeclined', handleCardDeclined);
    socket.on('userAvailableCard', handleUserAvailableCard);
    socket.on('footballPageUpdate', handleFootballUpdate);
    socket.on('footballMatchUpdate', handleFootballUpdate);
    socket.on('weatherUpdate', handleWeatherUpdate);

    return () => {
      socket.off('chessChallenge', handleChessChallenge);
      socket.off('chessDeclined', handleChessDeclined);
      socket.off('cardChallenge', handleCardChallenge);
      socket.off('cardDeclined', handleCardDeclined);
      socket.off('userAvailableCard', handleUserAvailableCard);
      socket.off('footballPageUpdate', handleFootballUpdate);
      socket.off('footballMatchUpdate', handleFootballUpdate);
      socket.off('weatherUpdate', handleWeatherUpdate);
    };
  }, [socket, user, navigation]);

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
      const skip = loadMore ? posts.length : 0;
      const limit = 9; // Load 9 posts at a time
      
      console.log(`📥 [FeedScreen] Fetching feed: skip=${skip}, limit=${limit}, loadMore=${loadMore}`);
      
      const data = await apiService.get(`${ENDPOINTS.GET_FEED}?limit=${limit}&skip=${skip}`);
      const postsArray = Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []);
      const responseHasMore = data.hasMore !== undefined ? data.hasMore : postsArray.length === limit;
      
      // Filter out duplicates by _id
      const uniquePosts = postsArray.filter((post: any, index: number, self: any[]) => {
        const postId = post._id?.toString?.() ?? String(post._id);
        return postId && self.findIndex((p: any) => {
          const pId = p._id?.toString?.() ?? String(p._id);
          return pId === postId;
        }) === index;
      });

      for (const p of uniquePosts as any[]) {
        const username = p?.postedBy?.username;
        if (username === 'Football' && footballFollowBoostTsRef.current) {
          const pid = p?._id?.toString?.() ?? String(p?._id);
          // User explicitly followed Football, so ensure the Football source isn't hidden anymore.
          unhideFeedSourceFromFeed('Football');
          if (pid) unhideFeedPostFromFeed(pid);
          if (pid) setViewerSortBoost(pid, footballFollowBoostTsRef.current);
          footballFollowBoostTsRef.current = 0;
        }
        if (username === 'Weather' && weatherFollowBoostTsRef.current) {
          const pid = p?._id?.toString?.() ?? String(p?._id);
          unhideFeedSourceFromFeed('Weather');
          if (pid) unhideFeedPostFromFeed(pid);
          if (pid) setViewerSortBoost(pid, weatherFollowBoostTsRef.current);
          weatherFollowBoostTsRef.current = 0;
        }
      }
      
      if (loadMore) {
        // Append new posts without re-sorting so Football/Weather stay in their page-1 position
        appendPosts(uniquePosts);
        setLoadingMore(false);
      } else {
        // Replace all posts (initial load or refresh)
        setPosts(filterPostsForFeed(uniquePosts));
        setLoading(false);
        setRefreshing(false);
      }
      
      setHasMore(responseHasMore);
      console.log(`✅ [FeedScreen] Fetched ${uniquePosts.length} unique posts (skip=${skip}, hasMore=${responseHasMore})`);
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
    setStoryRingReplayKey((k) => k + 1);
    fetchStoryStrip();
    fetchFeed(false); // Reset and fetch from beginning
  };

  const handleLoadMore = () => {
    // Guard: Don't load more when no posts (causes infinite loop - onEndReached fires on empty list)
    if (posts.length === 0) return;
    if (!loadingMore && hasMore && !isFetchingRef.current) {
      const now = Date.now();
      if (now - lastLoadMoreTimeRef.current < LOAD_MORE_DEBOUNCE_MS) {
        return; // Debounce rapid onEndReached fires
      }
      lastLoadMoreTimeRef.current = now;
      setLoadingMore(true);
      fetchFeed(true);
    }
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

  const handleAcceptChallenge = () => {
    if (!socket || !incomingChallenge) return;

    const roomId = `chess_${incomingChallenge.from}_${user?._id}_${Date.now()}`;
    
    socket.emit('acceptChessChallenge', {
      from: user?._id,
      to: incomingChallenge.from,
      roomId: roomId,
    });

    // Navigation happens via acceptChessChallenge socket (AppNavigator) so params match server (colors, etc.).
    setIncomingChallenge(null);
    showToast('Success', 'Challenge accepted!', 'success');
  };

  const handleDeclineChallenge = () => {
    if (!socket || !incomingChallenge) return;

    socket.emit('declineChessChallenge', {
      from: user?._id,
      to: incomingChallenge.from,
    });

    setIncomingChallenge(null);
    showToast('Info', 'Challenge declined', 'info');
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

  const handleAcceptCardChallenge = () => {
    if (!socket || !incomingCardChallenge) return;

    const roomId = `card_${incomingCardChallenge.from}_${user?._id}_${Date.now()}`;
    
    socket.emit('acceptCardChallenge', {
      from: user?._id,
      to: incomingCardChallenge.from,
      roomId: roomId,
    });

    setIncomingCardChallenge(null);
    showToast('Success', 'Challenge accepted!', 'success');
  };

  const handleDeclineCardChallenge = () => {
    if (!socket || !incomingCardChallenge) return;

    socket.emit('declineCardChallenge', {
      from: user?._id,
      to: incomingCardChallenge.from,
    });

    setIncomingCardChallenge(null);
    showToast('Info', 'Challenge declined', 'info');
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
    const uid = item.postedBy?._id?.toString?.() ?? '';
    const ring = uid ? storyByUserId[uid] : undefined;
    return (
      <Post post={item} storyRing={ring} storyRingReplayKey={storyRingReplayKey} />
    );
  };

  const quickActionsHeader = (
    <View style={styles.quickAccessHeaderContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickAccessScrollContent}
      >
        <TouchableOpacity
          style={[styles.quickAccessButton, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          onPress={() => navigation.navigate('Notifications')}
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
        data={loading ? [] : posts}
        renderItem={renderPost}
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
        onEndReachedThreshold={0.5}
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

      {/* Incoming Card Challenge Modal */}
      <Modal
        visible={!!incomingCardChallenge}
        transparent
        animationType="fade"
        onRequestClose={() => setIncomingCardChallenge(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.challengeModalContent}>
            <Text style={styles.challengeModalTitle}>🃏 Go Fish Challenge!</Text>
            <Text style={styles.challengeModalText}>
              {incomingCardChallenge?.fromName} challenged you to a Go Fish match!
            </Text>
            <View style={styles.challengeModalButtons}>
              <TouchableOpacity
                style={[styles.challengeModalButton, styles.declineButton]}
                onPress={handleDeclineCardChallenge}
              >
                <Text style={styles.challengeModalButtonText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.challengeModalButton, styles.acceptButton]}
                onPress={handleAcceptCardChallenge}
              >
                <Text style={styles.challengeModalButtonText}>Accept</Text>
              </TouchableOpacity>
            </View>
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

      {/* Incoming Challenge Modal */}
      <Modal
        visible={!!incomingChallenge}
        transparent
        animationType="slide"
        onRequestClose={() => setIncomingChallenge(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.challengeModalContent}>
            <Text style={styles.challengeModalTitle}>♟️ Chess Challenge!</Text>
            <Text style={styles.challengeModalText}>
              {incomingChallenge?.fromName} challenged you to a chess match!
            </Text>
            <View style={styles.challengeModalButtons}>
              <TouchableOpacity
                style={[styles.challengeModalButton, styles.declineButton]}
                onPress={handleDeclineChallenge}
              >
                <Text style={styles.challengeModalButtonText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.challengeModalButton, styles.acceptButton]}
                onPress={handleAcceptChallenge}
              >
                <Text style={styles.challengeModalButtonText}>Accept</Text>
              </TouchableOpacity>
            </View>
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
    gap: 12,
  },
  logoutButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 24,
    lineHeight: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    includeFontPadding: false,
    textAlign: 'center',
    marginTop: -4,
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  themeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
    fontSize: 21,
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
  challengeModalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 350,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  challengeModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  challengeModalText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  challengeModalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  challengeModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: COLORS.error,
  },
  acceptButton: {
    backgroundColor: COLORS.success,
  },
  challengeModalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});

export default FeedScreen;
