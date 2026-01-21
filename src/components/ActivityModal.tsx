import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { API_URL, COLORS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useUser } from '../context/UserContext';
import { useSocket } from '../context/SocketContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';

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

interface ActivityModalProps {
  visible: boolean;
  onClose: () => void;
  onActivityClick?: (activity: Activity) => void;
}

const formatTimeAgo = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
};

const ActivityModal: React.FC<ActivityModalProps> = ({
  visible,
  onClose,
  onActivityClick,
}) => {
  const { user } = useUser();
  const { socket } = useSocket();
  const showToast = useShowToast();
  
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (visible) {
      fetchActivities();
    }
  }, [visible]);

  // Listen for new activities
  useEffect(() => {
    if (!socket || !visible) return;

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
  }, [socket, visible, user?.following]);

  const fetchActivities = async () => {
    try {
      setLoading(true);
      const data = await apiService.get(ENDPOINTS.GET_ACTIVITY || '/api/activity');
      
      if (Array.isArray(data)) {
        // Filter activities from followed users only
        const followingIds = (user?.following || []).map((id: any) => id.toString());
        const filteredActivities = data
          .filter((activity: Activity) => {
            const activityUserId = activity.userId?._id?.toString();
            return activityUserId && followingIds.includes(activityUserId);
          })
          .filter((activity: Activity) => {
            // Filter out activities older than 6 hours
            const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
            return new Date(activity.createdAt) >= sixHoursAgo;
          })
          .slice(0, 15); // Limit to 15 most recent
        
        setActivities(filteredActivities);
      } else if (data.activities && Array.isArray(data.activities)) {
        const followingIds = (user?.following || []).map((id: any) => id.toString());
        const filteredActivities = data.activities
          .filter((activity: Activity) => {
            const activityUserId = activity.userId?._id?.toString();
            return activityUserId && followingIds.includes(activityUserId);
          })
          .filter((activity: Activity) => {
            const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
            return new Date(activity.createdAt) >= sixHoursAgo;
          })
          .slice(0, 15);
        
        setActivities(filteredActivities);
      }
    } catch (error) {
      console.error('Error fetching activities:', error);
      showToast('Error', 'Failed to load activities', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getActivityIcon = (type: string) => {
    switch (type) {
      case 'like': return '❤️';
      case 'comment': return '💬';
      case 'follow': return '👤';
      case 'post': return '📝';
      case 'reply': return '↩️';
      default: return '🔔';
    }
  };

  const getActivityText = (activity: Activity) => {
    const userName = activity.userId?.name || activity.userId?.username || 'Someone';
    
    switch (activity.type) {
      case 'like':
        return `${userName} liked a post`;
      case 'comment':
        return `${userName} commented on a post`;
      case 'follow':
        return `${userName} started following ${activity.targetUser?.name || activity.targetUser?.username || 'someone'}`;
      case 'post':
        return `${userName} created a new post`;
      case 'reply':
        return `${userName} replied to a comment`;
      default:
        return `${userName} performed an action`;
    }
  };

  const handleActivityPress = (activity: Activity) => {
    if (onActivityClick) {
      onActivityClick(activity);
    } else {
      // Default navigation behavior
      if (activity.postId?._id) {
        // Navigate to post detail - this will be handled by parent
        console.log('Activity clicked - post:', activity.postId._id);
      } else if (activity.userId?._id) {
        // Navigate to user profile - this will be handled by parent
        console.log('Activity clicked - user:', activity.userId.username);
      }
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
        setActivities(prev => prev.filter(a => a._id !== activityId));
      }
    } catch (error) {
      console.error('Error deleting activity:', error);
      showToast('Error', 'Failed to delete activity', 'error');
    }
  };

  const renderActivity = ({ item }: { item: Activity }) => (
    <TouchableOpacity
      style={styles.activityItem}
      onPress={() => handleActivityPress(item)}
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
        
        <View style={styles.activityTextContainer}>
          <Text style={styles.activityText}>{getActivityText(item)}</Text>
          <Text style={styles.activityTime}>{formatTimeAgo(item.createdAt)}</Text>
        </View>
      </View>
      
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={(e) => handleDeleteActivity(item._id, e)}
      >
        <Text style={styles.deleteButtonText}>🗑️</Text>
      </TouchableOpacity>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Live Activity</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : activities.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔴</Text>
              <Text style={styles.emptyText}>No recent activity</Text>
              <Text style={styles.emptySubtext}>
                Activity from users you follow will appear here
              </Text>
            </View>
          ) : (
            <FlatList
              data={activities}
              renderItem={renderActivity}
              keyExtractor={(item) => item._id}
              contentContainerStyle={styles.listContainer}
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    height: '90%',
    paddingTop: 10,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  closeButton: {
    padding: 5,
  },
  closeButtonText: {
    fontSize: 24,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
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
    fontSize: 24,
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
  activityTextContainer: {
    flex: 1,
  },
  activityText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
    marginBottom: 4,
  },
  activityTime: {
    fontSize: 13,
    color: COLORS.textGray,
  },
  deleteButton: {
    padding: 6,
    borderRadius: 6,
  },
  deleteButtonText: {
    fontSize: 18,
  },
});

export default ActivityModal;
