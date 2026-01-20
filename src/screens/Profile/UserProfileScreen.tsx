import React, { useState, useEffect } from 'react';
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

const UserProfileScreen = ({ route, navigation }: any) => {
  const { username: usernameParam } = route.params || {};
  const { user: currentUser } = useUser();
  const username = usernameParam === 'self' ? currentUser?.username : usernameParam;
  const showToast = useShowToast();

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
    fetchUserProfile();
    fetchUserPosts(false); // Initial load
  }, [username]);

  const fetchUserProfile = async () => {
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${username}`);
      setProfileUser(data);
      setFollowing(data.followers?.includes(currentUser?._id));
    } catch (error: any) {
      showToast('Error', 'Failed to load profile', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchUserPosts = async (isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setSkip(0);
      setHasMore(true);
    }
    
    try {
      const currentSkip = isLoadMore ? skip : 0;
      const data = await apiService.get(
        `${ENDPOINTS.GET_USER_POSTS}/${username}?limit=${POSTS_PER_PAGE}&skip=${currentSkip}`
      );
      
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
      console.error('Error fetching user posts:', error);
      showToast('Error', 'Failed to load posts', 'error');
    } finally {
      setLoadingMore(false);
      setRefreshing(false);
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
      await apiService.put(`${ENDPOINTS.FOLLOW_USER}/${profileUser._id}`);
      setFollowing(!following);
      showToast('Success', following ? 'Unfollowed' : 'Following', 'success');
    } catch (error: any) {
      showToast('Error', error.message || 'Failed to follow/unfollow', 'error');
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
        <Text style={styles.errorText}>User not found</Text>
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
              
              <View style={styles.stats}>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profileUser.postsCount || posts.length}</Text>
                  <Text style={styles.statLabel}>Posts</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profileUser.followers?.length || 0}</Text>
                  <Text style={styles.statLabel}>Followers</Text>
                </View>
                <View style={styles.statItem}>
                  <Text style={styles.statNumber}>{profileUser.following?.length || 0}</Text>
                  <Text style={styles.statLabel}>Following</Text>
                </View>
              </View>

              {!isOwnProfile && (
                <TouchableOpacity
                  style={[styles.followButton, following && styles.followingButton]}
                  onPress={handleFollow}
                  disabled={followLoading}
                >
                  <Text style={styles.followButtonText}>
                    {followLoading ? '...' : following ? 'Following' : 'Follow'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={styles.postsSection}>
              <Text style={styles.postsTitle}>Posts</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyText}>No posts yet</Text>
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
