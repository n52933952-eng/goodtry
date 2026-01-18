import React, { useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useUser } from '../context/UserContext';
import { usePost } from '../context/PostContext';
import { apiService } from '../services/api';
import { ENDPOINTS, COLORS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';

interface PostProps {
  post: any;
}

const Post: React.FC<PostProps> = ({ post }) => {
  const navigation = useNavigation<any>();
  const { user } = useUser();
  const { likePost, unlikePost, deletePost: deletePostContext } = usePost();
  const showToast = useShowToast();

  const [isLiking, setIsLiking] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const isLiked = post.likes?.includes(user?._id);
  const isOwner = post.postedBy?._id === user?._id;
  const isContributor = post.contributors?.some((c: any) => 
    (typeof c === 'string' ? c : c._id) === user?._id
  );

  const handleLike = async () => {
    if (isLiking || !user) return;

    setIsLiking(true);
    try {
      await apiService.put(`${ENDPOINTS.LIKE_POST}/${post._id}`);
      
      if (isLiked) {
        unlikePost(post._id, user._id);
      } else {
        likePost(post._id, user._id);
      }
    } catch (error: any) {
      console.error('Error liking post:', error);
      showToast('Error', 'Failed to like post', 'error');
    } finally {
      setIsLiking(false);
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

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={() => navigation.navigate('PostDetail', { postId: post._id })}
      activeOpacity={0.9}
    >
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.navigate('UserProfile', { username: post.postedBy?.username })}
        >
          {post.postedBy?.profilePic ? (
            <Image 
              source={{ uri: post.postedBy.profilePic }} 
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {post.postedBy?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
        </TouchableOpacity>

        <View style={styles.headerInfo}>
          <View style={styles.headerTop}>
            <Text style={styles.name}>{post.postedBy?.name || 'Unknown'}</Text>
            {post.isCollaborative && (
              <Text style={styles.collaborativeBadge}>👥</Text>
            )}
            <Text style={styles.time}>· {formatTime(post.createdAt)}</Text>
          </View>
          <Text style={styles.username}>@{post.postedBy?.username}</Text>
        </View>

        {isOwner && (
          <TouchableOpacity onPress={handleDelete} disabled={isDeleting}>
            <Text style={styles.deleteButton}>🗑️</Text>
          </TouchableOpacity>
        )}
      </View>

      <Text style={styles.text}>{post.text}</Text>

      {post.img && (
        <Image 
          source={{ uri: post.img }} 
          style={styles.postImage}
          resizeMode="cover"
        />
      )}

      {post.isWeatherPost && post.weatherData && (
        <View style={styles.weatherCard}>
          <Text style={styles.weatherCity}>{post.weatherData.city}</Text>
          <Text style={styles.weatherTemp}>
            {Math.round(post.weatherData.temperature)}°C
          </Text>
          <Text style={styles.weatherDesc}>{post.weatherData.description}</Text>
        </View>
      )}

      {post.isFootballPost && post.footballData && (
        <View style={styles.footballCard}>
          <Text style={styles.footballTeam}>
            {post.footballData.homeTeam} vs {post.footballData.awayTeam}
          </Text>
          <Text style={styles.footballScore}>
            {post.footballData.homeScore} - {post.footballData.awayScore}
          </Text>
          <Text style={styles.footballStatus}>{post.footballData.status}</Text>
        </View>
      )}

      <View style={styles.footer}>
        <TouchableOpacity 
          style={styles.actionButton} 
          onPress={handleLike}
          disabled={isLiking}
        >
          <Text style={styles.actionIcon}>
            {isLiked ? '❤️' : '🤍'}
          </Text>
          <Text style={styles.actionText}>{post.likes?.length || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.actionButton}
          onPress={() => navigation.navigate('PostDetail', { postId: post._id })}
        >
          <Text style={styles.actionIcon}>💬</Text>
          <Text style={styles.actionText}>{post.replies?.length || 0}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton}>
          <Text style={styles.actionIcon}>🔄</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    marginBottom: 10,
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
  name: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  collaborativeBadge: {
    marginLeft: 5,
    fontSize: 14,
  },
  time: {
    fontSize: 14,
    color: COLORS.textGray,
    marginLeft: 5,
  },
  username: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  deleteButton: {
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
  },
  weatherCard: {
    backgroundColor: COLORS.backgroundLight,
    padding: 15,
    borderRadius: 12,
    marginBottom: 10,
  },
  weatherCity: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  weatherTemp: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.primary,
  },
  weatherDesc: {
    fontSize: 14,
    color: COLORS.textGray,
    textTransform: 'capitalize',
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
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 10,
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
});

export default Post;
