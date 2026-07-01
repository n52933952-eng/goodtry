import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Image,
  RefreshControl,
  FlatList,
  DeviceEventEmitter,
  Modal,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Animated,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import StoryAvatarRing from '../../components/StoryAvatarRing';
import { apiService } from '../../services/api';
import { rememberFollowProfile, removeFollowProfile } from '../../utils/recentFollowProfiles';
import { API_URL, ENDPOINTS, STORY_STRIP_SHOULD_REFRESH } from '../../utils/constants';
import { navigateToMainStack } from '../../utils/navigationHelpers';
import { useLanguage } from '../../context/LanguageContext';
import { isUserFollowedByMe, toUserIdStr } from '../../utils/followState';
import { useSocket } from '../../context/SocketContext';
import { useLiveBroadcast } from '../../context/LiveBroadcastContext';
import LivePostCard from '../../components/LivePostCard';
import {
  buildLivePseudoPost,
  isLivePseudoPostId,
  normalizeStreamerId,
} from '../../utils/liveFeedPost';
import { pauseAllFeedVideos } from '../../utils/feedVideoPlayback';
import Svg, { Path } from 'react-native-svg';

const UserProfileScreen = ({ route, navigation }: any) => {
  const { username: usernameParam, userId: userIdParam } = route.params || {};
  const { user: currentUser, updateUser, logout, refetchSessionUser } = useUser();
  const { socket, liveStreams } = useSocket();
  const { isLive: isSelfBroadcasting } = useLiveBroadcast();
  const { colors } = useTheme();
  const username =
    usernameParam === 'self'
      ? currentUser?.username
      : (usernameParam || userIdParam);
  const showToast = useShowToast();
  const { t } = useLanguage();

  const [profileUser, setProfileUser] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [storyMeta, setStoryMeta] = useState<{
    active?: boolean;
    storyId?: string;
    hasUnviewed?: boolean;
  } | null>(null);
  /** Each profile focus: replay gray → red ring fill */
  const [storyRingReplayKey, setStoryRingReplayKey] = useState(0);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteMenuOpen, setDeleteMenuOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  /** Full-screen profile photo (Instagram-style). */
  const [profilePicPreviewOpen, setProfilePicPreviewOpen] = useState(false);
  
  // Pagination state
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const POSTS_PER_PAGE = 9;
  const [activeVideoPostId, setActiveVideoPostId] = useState<string | null>(null);
  const activeVideoPostIdRef = useRef<string | null>(null);
  const isScreenFocused = useIsFocused();
  /** Live status for this profile (API + socket); drives top LIVE card. */
  const [profileLiveMeta, setProfileLiveMeta] = useState<{ roomName: string } | null>(null);

  const profileUserId = profileUser?._id != null ? String(profileUser._id) : '';

  const followingSet = React.useMemo(() => {
    const ids = (currentUser?.following || []).map((id: unknown) => toUserIdStr(id)).filter(Boolean);
    return new Set(ids);
  }, [currentUser?.following]);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 65,
    minimumViewTime: 180,
  }).current;

  /** Floating "scroll to top" button (Twitter style: show scrolling down, hide scrolling up). */
  const profileListRef = useRef<FlatList>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const lastScrollYRef = useRef(0);
  const scrollDirAccumRef = useRef(0);
  const pastThresholdRef = useRef(false);
  const scrollTopBtnAnim = useRef(new Animated.Value(0)).current;

  const scrollProfileToTop = useCallback(() => {
    const list = profileListRef.current;
    if (list) {
      const y = lastScrollYRef.current;
      const winH = Dimensions.get('window').height;
      // Very far down: jump instantly so a long list doesn't render every row and freeze.
      list.scrollToOffset({ offset: 0, animated: y <= winH * 2.5 });
    }
    setShowScrollTop(false);
  }, []);

  const handleProfileScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;
      const accum = scrollDirAccumRef.current;
      scrollDirAccumRef.current = Math.sign(dy) === Math.sign(accum) ? accum + dy : dy;
      if (scrollDirAccumRef.current < -14) {
        setShowScrollTop((prev) => (prev ? false : prev));
      } else if (scrollDirAccumRef.current > 14 && pastThresholdRef.current) {
        setShowScrollTop((prev) => (prev ? prev : true));
      }
    },
    [],
  );

  useEffect(() => {
    Animated.timing(scrollTopBtnAnim, {
      toValue: showScrollTop ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [showScrollTop, scrollTopBtnAnim]);

  useEffect(() => {
    activeVideoPostIdRef.current = activeVideoPostId;
  }, [activeVideoPostId]);

  // Pause profile videos when leaving profile screen.
  useFocusEffect(
    React.useCallback(() => {
      return () => {
        pauseAllFeedVideos();
        setActiveVideoPostId(null);
        activeVideoPostIdRef.current = null;
      };
    }, [])
  );

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: any; isViewable?: boolean }> }) => {
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

      // Prefer the lower/next visible video while scrolling down.
      const preferred = visibleVideos.length > 0 ? visibleVideos[visibleVideos.length - 1] : null;
      const nextId = preferred?.item?._id?.toString?.() ?? null;
      if (activeVideoPostIdRef.current === nextId) return;
      setActiveVideoPostId(nextId);
      activeVideoPostIdRef.current = nextId;
    }
  ).current;

  // Dedicated viewability for the button: fires instantly (0% / 0ms) so it isn't delayed by the
  // video config. Eligible once the 4th post (index 3) is topmost; hysteresis avoids flicker.
  const onButtonViewable = useRef(
    ({ viewableItems }: { viewableItems: Array<{ isViewable?: boolean; index?: number | null }> }) => {
      const idxs = viewableItems
        .filter((v) => v?.isViewable && typeof v.index === 'number')
        .map((v) => v.index as number);
      if (idxs.length === 0) return;
      const firstVisible = Math.min(...idxs);
      if (firstVisible >= 3) {
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

  useEffect(() => {
    if (!username && usernameParam !== 'self') {
      showToast('Error', 'Invalid profile', 'error');
      if (navigation.canGoBack?.()) navigation.goBack();
      return;
    }
    setProfileUser(null);
    setPosts([]);
    setProfileLiveMeta(null);
    setFollowing(false);
    setLoading(true);
    setSkip(0);
    setHasMore(true);

    fetchUserProfile();
    if (!(userIdParam && !usernameParam)) {
      fetchUserPosts(false);
    }

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when resolved username changes
  }, [username]);

  // Button label: following[] (from /me, includes web) OR server isFollowedByMe.
  useEffect(() => {
    if (!profileUser || !currentUser) return;
    setFollowing(isUserFollowedByMe(profileUser, followingSet));
  }, [profileUser?._id, profileUser?.isFollowedByMe, followingSet]);

  useEffect(() => {
    if (!profileUser?._id) {
      setStoryMeta(null);
      return;
    }
    apiService
      .get(`${ENDPOINTS.STORY_STATUS}/${profileUser._id}`)
      .then((d) => setStoryMeta(d))
      .catch(() => setStoryMeta({ active: false }));
  }, [profileUser?._id]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(STORY_STRIP_SHOULD_REFRESH, () => {
      if (!profileUser?._id) return;
      setStoryRingReplayKey((k) => k + 1);
      apiService
        .get(`${ENDPOINTS.STORY_STATUS}/${profileUser._id}`)
        .then((d) => setStoryMeta(d))
        .catch(() => setStoryMeta({ active: false }));
    });
    return () => sub.remove();
  }, [profileUser?._id]);

  useFocusEffect(
    React.useCallback(() => {
      setStoryRingReplayKey((k) => k + 1);
    }, [])
  );

  // Refresh profile when screen comes into focus (own profile or after follow on web)
  useFocusEffect(
    React.useCallback(() => {
      const isOwnProfile = username === currentUser?.username || username === 'self';

      if (isOwnProfile) {
        setProfileUser(null);
        setPosts([]);
        setLoading(true);
        void refetchSessionUser?.().then((me) => {
          fetchUserProfile(me?.following);
        });
        fetchUserPosts(false);
        if (currentUser?._id) {
          apiService
            .get(`${ENDPOINTS.STORY_STATUS}/${currentUser._id}`)
            .then((d) => setStoryMeta(d))
            .catch(() => setStoryMeta({ active: false }));
        }
        return;
      }

      if (username) {
        void refetchSessionUser?.().then((me) => {
          fetchUserProfile(me?.following);
        });
      }
    }, [username, currentUser?.username, currentUser?._id])
  );

  // Update profile display immediately when user context changes (e.g., after profile update)
  useEffect(() => {
    // If viewing own profile and user context updated, sync profileUser with currentUser
    if (currentUser && (username === currentUser?.username || username === 'self')) {
      setProfileUser((prev: any) => {
        if (prev && prev._id === currentUser._id) {
          // Update profileUser with latest user data (especially profilePic, name, bio, etc.)
          // Preserve followersCount, followingCount from previous state
          return {
            ...prev,
            profilePic: currentUser.profilePic,
            name: currentUser.name,
            username: currentUser.username,
            bio: currentUser.bio,
            country: currentUser.country,
            email: currentUser.email,
            // Preserve counts to avoid resetting them
            followersCount: prev.followersCount,
            followingCount: prev.followingCount,
          };
        }
        return prev;
      });
    }
  }, [currentUser?.profilePic, currentUser?.name, currentUser?.username, currentUser?.bio, currentUser?.country, username]);

  const buildFollowingSet = (followingList?: unknown[]) => {
    const ids = (followingList ?? currentUser?.following ?? []).map((id: unknown) => toUserIdStr(id)).filter(Boolean);
    return new Set(ids);
  };

  const fetchUserProfile = async (followingOverride?: unknown[]) => {
    // Store current username to verify response is still relevant
    const currentUsername = username;
    
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${currentUsername}`);
      
      // Verify we're still viewing the same profile (prevent stale data)
      if (currentUsername !== username) {
        console.log('⚠️ [UserProfileScreen] Username changed during fetch, ignoring response');
        return;
      }

      const fSet = buildFollowingSet(followingOverride);
      const profileId = toUserIdStr(data._id);
      const followed =
        followingOverride !== undefined
          ? fSet.has(profileId)
          : isUserFollowedByMe(data, fSet);

      setProfileUser({ ...data, isFollowedByMe: followed });
      setFollowing(followed);

      // Posts API needs username — if we opened via userId (push), load posts after profile resolves.
      if (userIdParam && !usernameParam && data?.username) {
        fetchUserPosts(false, data.username);
      }
    } catch (error: any) {
      // Only show error if we're still viewing the same profile
      if (currentUsername === username) {
        showToast('Error', 'Failed to load profile', 'error');
      }
    } finally {
      // Only update loading state if we're still viewing the same profile
      if (currentUsername === username) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const fetchUserPosts = async (isLoadMore = false, postsUsernameOverride?: string) => {
    const postsUsername = postsUsernameOverride || profileUser?.username || username;
    // Store current username to verify response is still relevant
    const currentUsername = postsUsername;
    
    if (!currentUsername) {
      if (!isLoadMore) {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setSkip(0);
      setHasMore(true);
    }
    
    try {
      const currentSkip = isLoadMore ? skip : 0;
      const data = await apiService.get(
        `${ENDPOINTS.GET_USER_POSTS}/${currentUsername}?limit=${POSTS_PER_PAGE}&skip=${currentSkip}`
      );
      
      // Verify we're still viewing the same profile (prevent stale data)
      if (currentUsername !== (postsUsernameOverride || profileUser?.username || username)) {
        console.log('⚠️ [UserProfileScreen] Username changed during posts fetch, ignoring response');
        return;
      }
      
      const newPosts = data.posts || data || [];
      
      if (isLoadMore) {
        // Append new posts to existing ones, filtering out duplicates
        setPosts(prev => {
          const existingIds = new Set(prev.map(p => {
            const id = p._id?.toString?.() ?? String(p._id);
            return id;
          }));
          const uniqueNewPosts = newPosts.filter(p => {
            const id = p._id?.toString?.() ?? String(p._id);
            return !existingIds.has(id);
          });
          return [...prev, ...uniqueNewPosts];
        });
        setSkip(prev => prev + POSTS_PER_PAGE);
      } else {
        // Replace posts for initial load (never keep stale live pseudo-posts from API)
        setPosts(newPosts.filter((p: any) => !isLivePseudoPostId(p?._id)));
        setSkip(POSTS_PER_PAGE);
      }
      
      // Check if there are more posts (backend returns hasMore)
      if (data.hasMore !== undefined) {
        setHasMore(data.hasMore);
      } else {
        // Fallback: check if we got a full page
        setHasMore(newPosts.length === POSTS_PER_PAGE);
      }
    } catch (error) {
      // Only show error if we're still viewing the same profile
      if (currentUsername === username) {
        console.error('Error fetching user posts:', error);
        showToast('Error', 'Failed to load posts', 'error');
      }
    } finally {
      // Only update loading state if we're still viewing the same profile
      if (currentUsername === username) {
        setLoadingMore(false);
        setRefreshing(false);
      }
    }
  };
  
  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchUserPosts(true);
    }
  };

  const handleFollow = async () => {
    if (!profileUser || !currentUser) return;
    
    setFollowLoading(true);
    try {
      // Backend expects POST, not PUT (same as web)
      const data = await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${profileUser._id}`);

      if (data?.error) {
        showToast(t('error'), data.error, 'error');
        return;
      }

      const profileUserId = profileUser._id?.toString();
      const isCurrentlyFollowing = following;

      const nextIsFollowing =
        data?.action === 'follow'
          ? true
          : data?.action === 'unfollow'
            ? false
            : !isCurrentlyFollowing;

      setFollowing(nextIsFollowing);
      setProfileUser((prev: any) =>
        prev ? { ...prev, isFollowedByMe: nextIsFollowing } : prev,
      );

      const serverFollowing = data?.current?.following;
      const canTrustServerFollowing =
        Array.isArray(serverFollowing) &&
        (serverFollowing.length > 0 || (serverFollowing.length === 0 && !nextIsFollowing));

      let sessionFollowing: unknown[] | undefined;
      if (canTrustServerFollowing && Array.isArray(data?.current?.followers)) {
        sessionFollowing = serverFollowing;
        updateUser({
          following: serverFollowing as any,
          followers: data.current.followers as any,
        });
      } else if (canTrustServerFollowing) {
        sessionFollowing = serverFollowing;
        updateUser({
          following: serverFollowing as any,
          followers: currentUser.followers as any,
        });
      } else {
        const nextFollowing = isCurrentlyFollowing
          ? (currentUser.following || []).filter((id: any) => id?.toString() !== profileUserId)
          : [...(currentUser.following || []), profileUserId];
        sessionFollowing = nextFollowing;
        updateUser({ following: nextFollowing as any });
      }

      fetchUserProfile(sessionFollowing);

      if (nextIsFollowing) {
        rememberFollowProfile(profileUser);
      } else {
        removeFollowProfile(profileUserId);
      }

      showToast(t('success'), isCurrentlyFollowing ? t('unfollowed') : t('following'), 'success');
    } catch (error: any) {
      showToast(t('error'), error.message || t('failedToFollowUnfollow'), 'error');
    } finally {
      setFollowLoading(false);
    }
  };

  const isOwnProfile = profileUser?._id === currentUser?._id;

  const checkProfileLiveStatus = useCallback(async () => {
    if (!profileUserId) {
      setProfileLiveMeta(null);
      return;
    }
    try {
      const res = await fetch(
        `${API_URL}/api/call/livestream/${encodeURIComponent(profileUserId)}/status`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const st = await res.json().catch(() => ({}));
      if (st?.active === true) {
        setProfileLiveMeta({ roomName: st.roomName || `live_${profileUserId}` });
      } else {
        setProfileLiveMeta(null);
      }
    } catch {
      /* non-fatal */
    }
  }, [profileUserId]);

  useEffect(() => {
    if (!profileUserId) {
      setProfileLiveMeta(null);
      return;
    }
    void checkProfileLiveStatus();
  }, [profileUserId, checkProfileLiveStatus]);

  useEffect(() => {
    const sk = socket as { on?: Function; off?: Function } | null;
    if (!sk?.on || !profileUserId) return;

    const onStarted = (data: { streamerId?: string; roomName?: string }) => {
      const sid = normalizeStreamerId(data?.streamerId);
      if (!sid || sid !== profileUserId) return;
      setProfileLiveMeta({ roomName: data.roomName || `live_${sid}` });
    };
    const onEnded = (data: { streamerId?: string }) => {
      const sid = normalizeStreamerId(data?.streamerId);
      if (!sid || sid !== profileUserId) return;
      setProfileLiveMeta(null);
    };

    sk.on('livekit:streamStarted', onStarted);
    sk.on('livekit:streamEnded', onEnded);
    return () => {
      sk.off?.('livekit:streamStarted', onStarted);
      sk.off?.('livekit:streamEnded', onEnded);
    };
  }, [socket, profileUserId]);

  const activeLiveForProfile = useMemo(() => {
    if (!profileUserId) return null;
    const fromSocket = liveStreams.find((s) => String(s.streamerId) === profileUserId);
    if (fromSocket) return fromSocket;
    if (profileLiveMeta) {
      return {
        streamerId: profileUserId,
        streamerName: profileUser?.name,
        streamerProfilePic: profileUser?.profilePic,
        roomName: profileLiveMeta.roomName,
        username: profileUser?.username,
      };
    }
    return null;
  }, [
    profileUserId,
    liveStreams,
    profileLiveMeta,
    profileUser?.name,
    profileUser?.profilePic,
    profileUser?.username,
  ]);

  const displayPosts = useMemo(() => {
    const base = posts.filter((p) => !isLivePseudoPostId(p?._id));
    if (!profileUser || !activeLiveForProfile) return base;
    // Same as feed: don't show your own LIVE card while you are broadcasting.
    if (isOwnProfile && isSelfBroadcasting) return base;

    const pseudo = buildLivePseudoPost({
      streamerId: profileUserId,
      streamerName: activeLiveForProfile.streamerName || profileUser.name,
      streamerProfilePic: activeLiveForProfile.streamerProfilePic || profileUser.profilePic,
      username: profileUser.username,
      roomName: activeLiveForProfile.roomName,
    });
    if (!pseudo) return base;
    return [pseudo, ...base];
  }, [posts, profileUser, profileUserId, activeLiveForProfile, isOwnProfile, isSelfBroadcasting]);

  useFocusEffect(
    useCallback(() => {
      void checkProfileLiveStatus();
    }, [checkProfileLiveStatus])
  );

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        isOwnProfile ? (
          <TouchableOpacity
            onPress={() => setDeleteMenuOpen(true)}
            style={{
              marginRight: 10,
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
            }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Text style={{ color: colors.text, fontSize: 22, lineHeight: 22 }}>⋮</Text>
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, isOwnProfile, colors.text]);

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!profileUser) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.text }]}>{t('userNotFound')}</Text>
      </View>
    );
  }

  const PROFILE_AVATAR = 84;
  /** Tight ring: thin stroke + ~3px gap to avatar edge */
  const PROFILE_RING = 90;
  const OTHER_AVATAR = 78;
  const OTHER_RING = 84;

  const openProfilePicPreview = () => {
    if (profileUser?.profilePic) setProfilePicPreviewOpen(true);
  };
  const closeProfilePicPreview = () => setProfilePicPreviewOpen(false);

  const openMyStory = () => {
    if (!profileUser?._id) return;
    navigateToMainStack(navigation, 'StoryViewer', { userId: profileUser._id });
  };

  const openCreateStory = () => navigateToMainStack(navigation, 'CreateStory');

  const openDeleteAccount = () => {
    setDeleteMenuOpen(false);
    setDeleteConfirmText('');
    setDeleteOpen(true);
  };

  const confirmDeleteAccount = async () => {
    if (deletingAccount) return;
    const typed = deleteConfirmText.trim().toUpperCase();
    if (typed !== 'DELETE') return;
    setDeletingAccount(true);
    try {
      await apiService.delete(ENDPOINTS.DELETE_ACCOUNT, {
        data: {
          confirm: 'DELETE',
        },
      } as any);
      showToast(t('success'), t('deleteAccountSuccess'), 'success');
      setDeleteOpen(false);
      await logout();
    } catch (e: any) {
      showToast(t('error'), e?.message || t('deleteAccountFailed'), 'error');
    } finally {
      setDeletingAccount(false);
    }
  };

  const renderProfileAvatar = () => {
    if (isOwnProfile && !storyMeta?.active) {
      const inner = (
        <>
          {profileUser.profilePic ? (
            <Image source={{ uri: profileUser.profilePic }} style={styles.profileAvatarImageFill} />
          ) : (
            <View
              style={[
                styles.profileAvatarImageFill,
                styles.avatarPlaceholder,
                { backgroundColor: colors.avatarBg },
              ]}
            >
              <Text style={styles.profileAvatarLetter}>{profileUser.name?.[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
        </>
      );
      return (
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={openProfilePicPreview}
          disabled={!profileUser.profilePic}
          accessibilityRole="button"
          accessibilityLabel={profileUser.profilePic ? t('profilePhoto') : undefined}
        >
          <View
            style={[
              styles.profileAvatarBig,
              { width: PROFILE_AVATAR, height: PROFILE_AVATAR, borderRadius: PROFILE_AVATAR / 2 },
            ]}
          >
            {inner}
          </View>
        </TouchableOpacity>
      );
    }

    if (storyMeta?.active) {
      return (
        <StoryAvatarRing
          visible
          showAnimatedRedFill={!!storyMeta?.hasUnviewed}
          replayKey={storyRingReplayKey}
          ringOuterSize={isOwnProfile ? PROFILE_RING : OTHER_RING}
          avatarSize={isOwnProfile ? PROFILE_AVATAR : OTHER_AVATAR}
          strokeWidth={2}
        >
          <Pressable
            onPress={openMyStory}
            onLongPress={profileUser.profilePic ? openProfilePicPreview : undefined}
            delayLongPress={420}
            style={styles.profileAvatarTouchFill}
            accessibilityRole="button"
            accessibilityLabel={t('seeStory')}
          >
            {profileUser.profilePic ? (
              <Image source={{ uri: profileUser.profilePic }} style={styles.profileAvatarImageFill} />
            ) : (
              <View
                style={[
                  styles.profileAvatarImageFill,
                  styles.avatarPlaceholder,
                  { backgroundColor: colors.avatarBg },
                ]}
              >
                <Text style={styles.profileAvatarLetter}>{profileUser.name?.[0]?.toUpperCase() || '?'}</Text>
              </View>
            )}
          </Pressable>
        </StoryAvatarRing>
      );
    }

    const sz = OTHER_AVATAR;
    return (
      <TouchableOpacity
        activeOpacity={0.88}
        onPress={openProfilePicPreview}
        disabled={!profileUser.profilePic}
        accessibilityRole="button"
        accessibilityLabel={profileUser.profilePic ? t('profilePhoto') : undefined}
      >
        <View
          style={[
            styles.profileAvatarOtherPlain,
            { width: sz, height: sz, borderRadius: sz / 2, backgroundColor: colors.avatarBg },
          ]}
        >
          {profileUser.profilePic ? (
            <Image source={{ uri: profileUser.profilePic }} style={styles.profileAvatarImageFill} />
          ) : (
            <View style={[styles.profileAvatarImageFill, styles.avatarPlaceholder]}>
              <Text style={styles.profileAvatarLetter}>{profileUser.name?.[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        ref={profileListRef}
        data={displayPosts}
        keyExtractor={(item, index) => {
          // Ensure unique keys by using both _id and index as fallback
          const id = item._id?.toString?.() ?? String(item._id);
          return id || `post-${index}`;
        }}
        ItemSeparatorComponent={() => (
          <View style={[styles.postSeparator, { backgroundColor: colors.background }]} />
        )}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void checkProfileLiveStatus();
              void refetchSessionUser?.().then((me) => {
                fetchUserProfile(me?.following);
                fetchUserPosts(false);
              });
            }}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        onScroll={handleProfileScroll}
        scrollEventThrottle={16}
        viewabilityConfigCallbackPairs={viewabilityPairs}
        ListHeaderComponent={
          <View>
            <View
              style={[
                styles.profileHeader,
                { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border },
              ]}
            >
              <View style={styles.profileTopRow}>
                <View style={styles.profileAvatarCol}>{renderProfileAvatar()}</View>
                <View style={styles.profileTextCol}>
                  <Text style={[styles.name, { color: colors.text, marginBottom: 4 }]} numberOfLines={2}>
                    {profileUser.name}
                  </Text>
                  <Text style={[styles.username, { color: colors.textGray, marginBottom: 0 }]} numberOfLines={1}>
                    @{profileUser.username}
                  </Text>
                </View>
              </View>
              {!!profileUser.bio && (
                <Text style={[styles.bio, { color: colors.text, marginTop: 12 }]}>{profileUser.bio}</Text>
              )}

              {isOwnProfile && (
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[styles.halfButton, { backgroundColor: colors.primary }]}
                    onPress={() => navigation.navigate('UpdateProfile')}
                  >
                    <Text style={[styles.halfButtonText, { color: colors.buttonText }]} numberOfLines={1}>
                      {t('updateProfile')}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.halfButton, { backgroundColor: colors.border }]}
                    onPress={openCreateStory}
                  >
                    <View style={styles.halfButtonWithIcon}>
                      <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                        <Path
                          d="M12 5v14M5 12h14"
                          stroke={colors.text}
                          strokeWidth={2.5}
                          strokeLinecap="round"
                        />
                      </Svg>
                      <Text style={[styles.halfButtonText, { color: colors.text }]} numberOfLines={1}>
                        Add story
                      </Text>
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.halfButton, { backgroundColor: '#E53E3E' }]}
                    onPress={() => navigation.navigate('LiveBroadcast')}
                  >
                    <Text style={[styles.halfButtonText, { color: '#fff' }]} numberOfLines={1}>
                      🔴 Go Live
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {!isOwnProfile && (
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    style={[
                      styles.followButtonFullWidth,
                      { backgroundColor: following ? colors.border : colors.primary },
                      following && {
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={handleFollow}
                    disabled={followLoading}
                    activeOpacity={0.85}
                  >
                    {followLoading ? (
                      <ActivityIndicator color={following ? colors.text : colors.buttonText} />
                    ) : (
                      <Text
                        style={[
                          styles.halfButtonText,
                          { color: following ? colors.text : colors.buttonText },
                        ]}
                      >
                        {following ? t('following') : t('follow')}
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              )}
              
              <View style={[styles.stats, { borderTopColor: colors.border }]}>
                <View style={styles.statItem}>
                  <Text style={[styles.statNumber, { color: colors.text }]}>{posts.length}</Text>
                  <Text style={[styles.statLabel, { color: colors.textGray }]}>{t('posts')}</Text>
                </View>
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() =>
                    navigation.navigate('FollowList', {
                      listType: 'followers',
                      ...(isOwnProfile
                        ? {}
                        : {
                            userId: profileUser._id,
                            displayUsername: profileUser.username,
                          }),
                    })
                  }
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('followers')}
                >
                  <Text style={[styles.statNumber, { color: colors.text }]}>
                    {profileUser.followersCount ?? (profileUser.followers?.length || 0)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textGray }]}>{t('followers')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.statItem}
                  onPress={() =>
                    navigation.navigate('FollowList', {
                      listType: 'following',
                      ...(isOwnProfile
                        ? {}
                        : {
                            userId: profileUser._id,
                            displayUsername: profileUser.username,
                          }),
                    })
                  }
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={t('following')}
                >
                  <Text style={[styles.statNumber, { color: colors.text }]}>
                    {profileUser.followingCount ?? (profileUser.following?.length || 0)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textGray }]}>{t('following')}</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View
              style={[
                styles.postsSection,
                { backgroundColor: colors.background, borderBottomColor: colors.border },
              ]}
            >
              <Text style={[styles.postsTitle, { color: colors.text }]}>{t('posts')}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={[styles.emptyText, { color: colors.textGray }]}>{t('noPostsYet')}</Text>
          ) : null
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadingMoreContainer}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.isLive) {
            return <LivePostCard post={item} />;
          }
          return (
            <Post
              post={item}
              feedWideCard
              fromScreen="UserProfile"
              userProfileParams={{ username }}
              screenFocused={isScreenFocused}
              autoPlayMedia={
                isScreenFocused && String(item?._id || '') === activeVideoPostId
              }
              onPostUpdated={(updated) => {
                if (!updated?._id) return;
                setPosts((prev) =>
                  prev.map((p) =>
                    String(p._id) === String(updated._id) ? { ...p, ...updated } : p
                  )
                );
              }}
              onPostDeleted={(deletedId) => {
                if (!deletedId) return;
                setPosts((prev) => prev.filter((p) => String(p._id) !== String(deletedId)));
              }}
            />
          );
        }}
      />

      {/* Floating scroll-to-top button (always mounted; visibility is animated) */}
      <Animated.View
        pointerEvents={showScrollTop ? 'box-none' : 'none'}
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
          onPress={scrollProfileToTop}
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

      <Modal
        visible={profilePicPreviewOpen && !!profileUser?.profilePic}
        transparent
        animationType="fade"
        onRequestClose={closeProfilePicPreview}
      >
        <View style={styles.profilePicPreviewRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeProfilePicPreview}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
          />
          <View style={styles.profilePicPreviewImageWrap} pointerEvents="box-none">
            {profileUser?.profilePic ? (
              <Image
                source={{ uri: profileUser.profilePic }}
                style={[
                  styles.profilePicPreviewImage,
                  {
                    width: Dimensions.get('window').width,
                    height: Dimensions.get('window').height * 0.82,
                  },
                ]}
                resizeMode="contain"
                pointerEvents="none"
              />
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.profilePicPreviewClose}
            onPress={closeProfilePicPreview}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel={t('close')}
          >
            <Text style={styles.profilePicPreviewCloseText}>✕</Text>
          </TouchableOpacity>
          {storyMeta?.active && (
            <TouchableOpacity
              style={[styles.profilePicPreviewStoryBtn, { backgroundColor: colors.primary }]}
              onPress={() => {
                closeProfilePicPreview();
                openMyStory();
              }}
              activeOpacity={0.9}
            >
              <Text style={[styles.profilePicPreviewStoryBtnText, { color: colors.buttonText }]}>
                {t('seeStory')}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>

      <Modal visible={deleteMenuOpen} transparent animationType="fade" onRequestClose={() => setDeleteMenuOpen(false)}>
        <Pressable style={styles.deleteMenuOverlay} onPress={() => setDeleteMenuOpen(false)}>
          <Pressable
            style={[styles.deleteMenuSheet, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <TouchableOpacity style={styles.deleteMenuAction} onPress={openDeleteAccount} activeOpacity={0.85}>
              <Text style={[styles.deleteMenuActionText, { color: colors.error }]}>{t('deleteAccount')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={deleteOpen} transparent animationType="fade" onRequestClose={() => setDeleteOpen(false)}>
        <KeyboardAvoidingView style={styles.deleteOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={styles.deleteBackdrop} onPress={() => setDeleteOpen(false)} />
          <Pressable
            style={[styles.deleteSheet, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.deleteTitle, { color: colors.text }]}>{t('deleteAccountTitle')}</Text>
            <Text style={[styles.deleteBody, { color: colors.textGray }]}>{t('deleteAccountBody')}</Text>

            <Text style={[styles.deleteLabel, { color: colors.textGray }]}>{t('typeDeleteToConfirm')}</Text>
            <TextInput
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              autoCapitalize="characters"
              placeholder="DELETE"
              placeholderTextColor={colors.textGray}
              style={[
                styles.deleteInput,
                { borderColor: colors.border, color: colors.text, backgroundColor: colors.background },
              ]}
            />

            <View style={styles.deleteActions}>
              <TouchableOpacity onPress={() => setDeleteOpen(false)} style={[styles.deleteBtn, { borderColor: colors.border }]}>
                <Text style={[styles.deleteBtnText, { color: colors.text }]}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmDeleteAccount}
                disabled={deletingAccount || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                style={[
                  styles.deleteBtn,
                  {
                    backgroundColor:
                      deleteConfirmText.trim().toUpperCase() === 'DELETE' ? colors.error : colors.border,
                    borderColor: 'transparent',
                  },
                ]}
              >
                {deletingAccount ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={[styles.deleteBtnText, { color: '#fff' }]}>{t('confirmDelete')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileHeader: {
    alignItems: 'stretch',
    paddingTop: 16,
    paddingBottom: 20,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  profileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    direction: 'ltr',
  },
  profileAvatarCol: {
    marginRight: 14,
  },
  profileTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  profileAvatarBig: {
    overflow: 'hidden',
    backgroundColor: COLORS.background,
  },
  profileAvatarTouchFill: {
    width: '100%',
    height: '100%',
  },
  profileAvatarImageFill: {
    width: '100%',
    height: '100%',
  },
  profileAvatarOtherPlain: {
    overflow: 'hidden',
  },
  profileAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 12,
    gap: 10,
  },
  halfButton: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halfButtonWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minWidth: 0,
    maxWidth: '100%',
  },
  halfButtonText: {
    fontWeight: '700',
    fontSize: 13,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  username: {
    fontSize: 15,
    color: COLORS.textGray,
    textAlign: 'left',
    alignSelf: 'flex-start',
  },
  bio: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'left',
    lineHeight: 20,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 4,
    paddingTop: 18,
    marginBottom: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statItem: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  statLabel: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  /** Same height/radius as halfButton — full width for Follow / Following */
  followButtonFullWidth: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 30,
    paddingVertical: 10,
    borderRadius: 20,
    marginBottom: 15,
  },
  updateButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  dangerButton: {
    marginTop: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButtonText: {
    fontSize: 14,
    fontWeight: '700',
  },
  listContent: {
    paddingBottom: 28,
  },
  postSeparator: {
    height: 8,
  },
  postsSection: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
  },
  postsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.text,
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.textGray,
    marginTop: 30,
    marginBottom: 30,
  },
  loadingMoreContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  errorText: {
    fontSize: 16,
    color: COLORS.textGray,
    textAlign: 'center',
    marginTop: 50,
  },

  deleteOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  deleteBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  deleteSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  deleteTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 8,
  },
  deleteBody: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  deleteLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 6,
  },
  deleteInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  deleteActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    gap: 10,
  },
  deleteBtn: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  deleteMenuOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 56,
    paddingRight: 10,
  },
  deleteMenuSheet: {
    minWidth: 170,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  deleteMenuAction: {
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  deleteMenuActionText: {
    fontSize: 15,
    fontWeight: '700',
  },
  profilePicPreviewRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    justifyContent: 'center',
  },
  profilePicPreviewImageWrap: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profilePicPreviewImage: {
    maxWidth: '100%',
  },
  profilePicPreviewClose: {
    position: 'absolute',
    top: 48,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  profilePicPreviewCloseText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
  profilePicPreviewStoryBtn: {
    position: 'absolute',
    bottom: 42,
    alignSelf: 'center',
    paddingVertical: 12,
    paddingHorizontal: 22,
    borderRadius: 24,
    zIndex: 10,
  },
  profilePicPreviewStoryBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
});

export default UserProfileScreen;
