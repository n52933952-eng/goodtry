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
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const UserProfileScreen = ({ route, navigation }: any) => {
  const { username: usernameParam } = route.params;
  const { user: currentUser } = useUser();
  const username = usernameParam === 'self' ? currentUser?.username : usernameParam;
  const showToast = useShowToast();

  const [profileUser, setProfileUser] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);

  useEffect(() => {
    fetchUserProfile();
    fetchUserPosts();
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

  const fetchUserPosts = async () => {
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_USER_POSTS}/${username}`);
      setPosts(data.posts || []);
    } catch (error) {
      console.error('Error fetching user posts:', error);
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchUserProfile();
              fetchUserPosts();
            }}
          />
        }
      >
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
              <Text style={styles.statNumber}>{posts.length}</Text>
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
          {posts.map((post) => (
            <Post key={post._id} post={post} />
          ))}
          {posts.length === 0 && (
            <Text style={styles.emptyText}>No posts yet</Text>
          )}
        </View>
      </ScrollView>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    fontSize: 16,
    color: COLORS.primary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  profileHeader: {
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 15,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 40,
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
  },
  errorText: {
    fontSize: 16,
    color: COLORS.textGray,
    textAlign: 'center',
    marginTop: 50,
  },
});

export default UserProfileScreen;
