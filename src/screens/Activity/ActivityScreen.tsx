import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useLanguage } from '../../context/LanguageContext';

const formatTimeAgo = (dateString: string) => {
  try {
    const date = new Date(dateString);
    const now = new Date();
    
    // Validate date
    if (isNaN(date.getTime())) {
      console.warn('⚠️ [formatTimeAgo] Invalid date:', dateString);
      return 'unknown';
    }
    
    const diffMs = now.getTime() - date.getTime();
    
    // Handle negative differences (future dates - shouldn't happen but handle gracefully)
    if (diffMs < 0) {
      console.warn('⚠️ [formatTimeAgo] Future date detected:', dateString);
      return 'just now';
    }
    
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffWeeks = Math.floor(diffDays / 7);
    const diffMonths = Math.floor(diffDays / 30);

    if (diffMins < 1)       return t('justNow');
    if (diffMins < 60) return `${diffMins}m ${t('ago')}`;
    if (diffHours < 24) return `${diffHours}h ${t('ago')}`;
    if (diffDays < 7) return `${diffDays}d ${t('ago')}`;
    if (diffWeeks < 4) return `${diffWeeks}w ${t('ago')}`;
    if (diffMonths < 12) return `${diffMonths}mo ${t('ago')}`;
    return date.toLocaleDateString();
  } catch (error) {
    console.error('❌ [formatTimeAgo] Error formatting date:', error, dateString);
    return 'unknown';
  }
};

interface ActivityScreenProps {
  navigation: any;
}

interface Activity {
  _id: string;
  type: string;
  userId: {
    _id: string;
    name: string;
    username: string;
    profilePic?: string;
  };
  targetUser?: {
    _id: string;
    name: string;
    username: string;
  };
  postId?: {
    _id: string;
    postedBy?: {
      username: string;
    };
  };
  createdAt: string;
}

const ActivityScreen: React.FC<ActivityScreenProps> = ({ navigation }) => {
  const { user } = useUser();
  const { socket } = useSocket();
  const showToast = useShowToast();
  const { t } = useLanguage();
  
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchActivities();
  }, []);

  // Listen for new activities
  useEffect(() => {
    if (!socket) return;

    const handleNewActivity = (activity: Activity) => {
      // Only add activity if it's from a user we follow
      if (!user?.following || !activity?.userId?._id) {
        return;
      }
      
      const activityUserId = activity.userId._id.toString();
      const isFollowing = user.following.some((followId: string) => 
        followId.toString() === activityUserId
      );
      
      if (!isFollowing) {
        return;
      }
      
      setActivities(prev => {
        // Filter out activities older than 6 hours
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        const recentActivities = prev.filter(a => 
          new Date(a.createdAt) >= sixHoursAgo
        );
        // Add new activity at the beginning, keep only 15
        return [activity, ...recentActivities].slice(0, 15);
      });
    };

    socket.on('newActivity', handleNewActivity);

    return () => {
      socket.off('newActivity', handleNewActivity);
    };
  }, [socket, user?.following]);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/activity`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data.activities) {
        // Filter out activities older than 6 hours and limit to 15
        const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
        const recentActivities = data.activities
          .filter((activity: Activity) => new Date(activity.createdAt) >= sixHoursAgo)
          .slice(0, 15);
        setActivities(recentActivities);
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
      showToast('Error', 'Failed to load activities', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleDeleteActivity = async (activityId: string, e: any) => {
    e.stopPropagation();
    
    try {
      const baseUrl = API_URL;
      const res = await fetch(`${baseUrl}/api/activity/${activityId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setActivities(prev => prev.filter(activity => activity._id !== activityId));
      }
    } catch (error) {
      console.error('Error deleting activity:', error);
    }
  };

  const handleActivityClick = (activity: Activity) => {
    if (activity.postId) {
      const username = activity.postId?.postedBy?.username || activity.userId?.username;
      if (username) {
        navigation.navigate('UserProfile', {
          username,
          postId: activity.postId._id,
        });
      }
    } else if (activity.targetUser) {
      navigation.navigate('UserProfile', {
        username: activity.targetUser.username,
      });
    } else if (activity.userId) {
      navigation.navigate('UserProfile', {
        username: activity.userId.username,
      });
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'like':
        return '❤️';
      case 'comment':
        return '💬';
      case 'follow':
        return '👤';
      case 'post':
        return '📝';
      case 'reply':
        return '↩️';
      default:
        return '🔔';
    }
  };

  const getActivityText = (activity: Activity) => {
    const userName = activity.userId?.name || activity.userId?.username || t('someone');
    
    switch (activity.type) {
      case 'like':
        return `${userName} ${t('likedAPost')}`;
      case 'comment':
        return `${userName} ${t('commentedOnAPost')}`;
      case 'follow':
        const targetName = activity.targetUser?.name || activity.targetUser?.username || t('someone');
        return `${userName} ${t('followed')} ${targetName}`;
      case 'post':
        return `${userName} ${t('createdAPost')}`;
      case 'reply':
        return `${userName} ${t('repliedToAComment')}`;
      default:
        return `${userName} ${t('didSomething')}`;
    }
  };

  const renderActivity = ({ item }: { item: Activity }) => (
    <TouchableOpacity
      style={styles.activityItem}
      onPress={() => handleActivityClick(item)}
    >
      <View style={styles.activityContent}>
        <Text style={styles.activityIcon}>{getActivityIcon(item.type)}</Text>
        
        {item.userId?.profilePic ? (
          <Image 
            source={{ uri: item.userId.profilePic }} 
            style={styles.avatar}
          />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>
              {item.userId?.name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
        )}
        
        <View style={styles.textContainer}>
          <Text style={styles.activityText}>{getActivityText(item)}</Text>
          <Text style={styles.activityTime}>
            {formatTimeAgo(item.createdAt)}
          </Text>
        </View>
      </View>
      
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={(e) => handleDeleteActivity(item._id, e)}
      >
        <Text style={styles.deleteButtonText}>✕</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('liveActivity')}</Text>
      </View>

      <FlatList
        data={activities}
        renderItem={renderActivity}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchActivities();
            }}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyText}>{t('noActivity')}</Text>
            <Text style={styles.emptySubtext}>
              {t('activitiesFromUsersYouFollow')}
            </Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
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
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  activityContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  activityIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  textContainer: {
    flex: 1,
  },
  activityText: {
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 4,
  },
  activityTime: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  deleteButton: {
    padding: 8,
    borderRadius: 6,
  },
  deleteButtonText: {
    fontSize: 18,
    color: COLORS.textGray,
  },
  emptyContainer: {
    padding: 60,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 10,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textGray,
    textAlign: 'center',
    lineHeight: 20,
  },
});

export default ActivityScreen;
