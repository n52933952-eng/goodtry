import React, { useState, useEffect } from 'react';
import { useFocusEffect } from '@react-navigation/native';
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
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import StoryAvatarRing from '../../components/StoryAvatarRing';
import { apiService } from '../../services/api';
import { ENDPOINTS, STORY_STRIP_SHOULD_REFRESH } from '../../utils/constants';
import { navigateToMainStack } from '../../utils/navigationHelpers';
import { useLanguage } from '../../context/LanguageContext';
import Svg, { Path } from 'react-native-svg';

const UserProfileScreen = ({ route, navigation }: any) => {
  const { username: usernameParam } = route.params || {};
  const { user: currentUser, updateUser } = useUser();
  const { colors } = useTheme();
  const username =
    usernameParam === 'self' ? currentUser?.username : usernameParam;
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
  
  // Pagination state
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const POSTS_PER_PAGE = 9;

  useEffect(() => {
    if (!username && usernameParam !== 'self') {
      showToast('Error', 'Invalid profile', 'error');
      if (navigation.canGoBack?.()) navigation.goBack();
      return;
    }
    setProfileUser(null);
    setPosts([]);
    setFollowing(false);
    setLoading(true);
    setSkip(0);
    setHasMore(true);

    fetchUserProfile();
    fetchUserPosts(false);

    return () => {};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when resolved username changes
  }, [username]);

  // Update following state immediately from UserContext when profile user or currentUser changes
  // This ensures the button shows correct state even before backend response
  useEffect(() => {
    if (profileUser && currentUser) {
      const profileUserId = profileUser._id?.toString();
      const isFollowingFromContext = (currentUser.following || []).some(
        (id: any) => id?.toString() === profileUserId
      );
      setFollowing(isFollowingFromContext);
    }
  }, [profileUser?._id, currentUser?.following]);

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

  // Refresh profile when screen comes into focus (e.g., returning from UpdateProfile or CreatePost)
  useFocusEffect(
    React.useCallback(() => {
      const isOwnProfile = username === currentUser?.username || username === 'self';
      
      // If viewing own profile, clear state first to prevent showing stale data
      if (isOwnProfile) {
        setProfileUser(null);
        setPosts([]);
        setLoading(true);
        fetchUserProfile();
        fetchUserPosts(false); // Also refresh posts to show newly created posts
        if (currentUser?._id) {
          apiService
            .get(`${ENDPOINTS.STORY_STATUS}/${currentUser._id}`)
            .then((d) => setStoryMeta(d))
            .catch(() => setStoryMeta({ active: false }));
        }
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

  const fetchUserProfile = async () => {
    // Store current username to verify response is still relevant
    const currentUsername = username;
    
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${currentUsername}`);
      
      // Verify we're still viewing the same profile (prevent stale data)
      if (currentUsername !== username) {
        console.log('⚠️ [UserProfileScreen] Username changed during fetch, ignoring response');
        return;
      }
      
      setProfileUser(data);
      
      // Check UserContext first for immediate accuracy (avoids double follow)
      const profileUserId = data._id?.toString();
      const isFollowingFromContext = (currentUser?.following || []).some(
        (id: any) => id?.toString() === profileUserId
      );
      
      // Prefer backend-calculated follow state (works even if follower list is capped for scalability)
      // But also verify against UserContext to ensure consistency
      if (typeof data?.isFollowedByMe === 'boolean') {
        // Use backend value, but UserContext useEffect will sync it if different
        setFollowing(data.isFollowedByMe);
      } else {
        // Fallback: check both backend followers list and UserContext
        const isFollowingFromBackend = data.followers?.includes(currentUser?._id);
        // Prefer UserContext as source of truth (most up-to-date)
        setFollowing(isFollowingFromContext || isFollowingFromBackend);
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

  const fetchUserPosts = async (isLoadMore = false) => {
    // Store current username to verify response is still relevant
    const currentUsername = username;
    
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
      if (currentUsername !== username) {
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
        // Replace posts for initial load
        setPosts(newPosts);
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
      await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${profileUser._id}`);
      
      const profileUserId = profileUser._id?.toString();
      const isCurrentlyFollowing = following;
      const nextFollowing = isCurrentlyFollowing
        ? (currentUser.following || []).filter((id: any) => id?.toString() !== profileUserId)
        : [...(currentUser.following || []), profileUserId];
      
      // Update local state
      setFollowing(!following);
      
      // Update UserContext so other screens (like SearchScreen) reflect the change
      updateUser({ following: nextFollowing as any });
      
      // Refresh profile to get updated followers/following counts
      fetchUserProfile();
      
      showToast(t('success'), following ? t('unfollowed') : t('following'), 'success');
    } catch (error: any) {
      showToast(t('error'), error.message || t('failedToFollowUnfollow'), 'error');
    } finally {
      setFollowLoading(false);
    }
  };

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

  const isOwnProfile = profileUser._id === currentUser?._id;

  const PROFILE_AVATAR = 96;
  /** Tight ring: thin stroke + ~3px gap to avatar edge */
  const PROFILE_RING = 102;
  const OTHER_AVATAR = 88;
  const OTHER_RING = 94;

  const openMyStory = () => {
    if (!profileUser?._id) return;
    navigateToMainStack(navigation, 'StoryViewer', { userId: profileUser._id });
  };

  const openCreateStory = () => navigateToMainStack(navigation, 'CreateStory');

  const renderProfileAvatar = () => {
    if (isOwnProfile && !storyMeta?.active) {
      return (
        <View
          style={[
            styles.profileAvatarBig,
            { width: PROFILE_AVATAR, height: PROFILE_AVATAR, borderRadius: PROFILE_AVATAR / 2 },
          ]}
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
        </View>
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
          <TouchableOpacity
            activeOpacity={0.88}
            onPress={openMyStory}
            style={styles.profileAvatarTouchFill}
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
          </TouchableOpacity>
        </StoryAvatarRing>
      );
    }

    const sz = OTHER_AVATAR;
    return (
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
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={posts}
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
              fetchUserProfile();
              fetchUserPosts(false);
            }}
          />
        }
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
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
                    <Text style={[styles.halfButtonText, { color: colors.buttonText }]}>{t('updateProfile')}</Text>
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
                      <Text style={[styles.halfButtonText, { color: colors.text }]}>Add story</Text>
                    </View>
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
                <View style={styles.statItem}>
                  <Text style={[styles.statNumber, { color: colors.text }]}>
                    {profileUser.followersCount ?? (profileUser.followers?.length || 0)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textGray }]}>{t('followers')}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={[styles.statNumber, { color: colors.text }]}>
                    {profileUser.followingCount ?? (profileUser.following?.length || 0)}
                  </Text>
                  <Text style={[styles.statLabel, { color: colors.textGray }]}>{t('following')}</Text>
                </View>
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
        renderItem={({ item }) => (
          <View
            style={[styles.profilePostCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}
          >
            <Post
              post={item}
              fromScreen="UserProfile"
              userProfileParams={{ username }}
              onPostUpdated={(updated) => {
                if (!updated?._id) return;
                setPosts((prev) =>
                  prev.map((p) =>
                    String(p._id) === String(updated._id) ? { ...p, ...updated } : p
                  )
                );
              }}
            />
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  },
  profileAvatarCol: {
    marginRight: 14,
  },
  profileTextCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
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
    fontSize: 36,
    fontWeight: '700',
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    marginTop: 14,
    gap: 10,
  },
  halfButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  halfButtonWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  halfButtonText: {
    fontWeight: '700',
    fontSize: 14,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  username: {
    fontSize: 15,
    color: COLORS.textGray,
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
  listContent: {
    paddingBottom: 28,
  },
  postSeparator: {
    height: 10,
  },
  profilePostCard: {
    marginHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
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
});

export default UserProfileScreen;
