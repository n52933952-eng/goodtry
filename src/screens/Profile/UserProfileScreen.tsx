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
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useLanguage } from '../../context/LanguageContext';

const UserProfileScreen = ({ route, navigation }: any) => {
  const { username: usernameParam } = route.params || {};
  const { user: currentUser, updateUser } = useUser();
  const username = usernameParam === 'self' ? currentUser?.username : usernameParam;
  const showToast = useShowToast();
  const { t } = useLanguage();

  const [profileUser, setProfileUser] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  
  // Pagination state
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const POSTS_PER_PAGE = 9;

  useEffect(() => {
    // Clear previous data immediately when username changes to prevent showing stale data
    setProfileUser(null);
    setPosts([]);
    setFollowing(false);
    setLoading(true);
    setSkip(0);
    setHasMore(true);
    
    // Fetch new data
    fetchUserProfile();
    fetchUserPosts(false); // Initial load
    
    // Cleanup function to prevent state updates if component unmounts or username changes
    return () => {
      // This will prevent stale data from being set if navigation changes
    };
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
      }
    }, [username, currentUser?.username])
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!profileUser) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('userNotFound')}</Text>
      </View>
    );
  }

  const isOwnProfile = profileUser._id === currentUser?._id;

  return (
    <View style={styles.container}>
      <FlatList
        data={posts}
        keyExtractor={(item, index) => {
          // Ensure unique keys by using both _id and index as fallback
          const id = item._id?.toString?.() ?? String(item._id);
          return id || `post-${index}`;
        }}
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
            <View style={styles.profileHeader}>
              {profileUser.profilePic ? (
                <Image source={{ uri: profileUser.profilePic }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarText}>
                    {profileUser.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
              <Text style={styles.name}>{profileUser.name}</Text>
              <Text style={styles.username}>@{profileUser.username}</Text>
              {profileUser.bio && <Text style={styles.bio}>{profileUser.bio}</Text>}
              
              {isOwnProfile && (
                <TouchableOpacity
                  style={styles.updateButton}
                  onPress={() => navigation.navigate('UpdateProfile')}
                >
                  <Text style={styles.updateButtonText}>{t('updateProfile')}</Text>
                </TouchableOpacity>
              )}
              
              {!isOwnProfile && (
                <TouchableOpacity
                  style={[styles.followButton, following && styles.followingButton]}
                  onPress={handleFollow}
                  disabled={followLoading}
                >
                  {followLoading ? (
                    <ActivityIndicator color={following ? COLORS.text : '#FFFFFF'} />
                  ) : (
                    <Text style={[styles.followButtonText, following && styles.followingButtonText]}>
                      {following ? t('following') : t('follow')}
                    </Text>
                  )}
                </TouchableOpacity>
              )}
              
              <View style={styles.stats}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{posts.length}</Text>
                  <Text style={styles.statLabel}>{t('posts')}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>
                    {profileUser.followersCount ?? (profileUser.followers?.length || 0)}
                  </Text>
                  <Text style={styles.statLabel}>{t('followers')}</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>
                    {profileUser.followingCount ?? (profileUser.following?.length || 0)}
                  </Text>
                  <Text style={styles.statLabel}>{t('following')}</Text>
                </View>
              </View>
            </View>
            <View style={styles.postsSection}>
              <Text style={styles.postsTitle}>{t('posts')}</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyText}>{t('noPostsYet')}</Text>
          ) : null
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.loadingMoreContainer}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <Post 
            post={item} 
            fromScreen="UserProfile"
            userProfileParams={{ username }}
          />
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
    alignItems: 'center',
    paddingTop: 5,
    paddingBottom: 20,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    marginBottom: 8,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  name: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 5,
  },
  username: {
    fontSize: 16,
    color: COLORS.textGray,
    marginBottom: 10,
  },
  bio: {
    fontSize: 14,
    color: COLORS.text,
    textAlign: 'center',
    marginBottom: 15,
  },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginBottom: 15,
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
  followButton: {
    backgroundColor: COLORS.primary,
    paddingHorizontal: 30,
    paddingVertical: 10,
    borderRadius: 20,
  },
  followingButton: {
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  followButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  followingButtonText: {
    color: COLORS.text,
    fontWeight: 'bold',
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
  postsSection: {
    padding: 15,
  },
  postsTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 15,
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
