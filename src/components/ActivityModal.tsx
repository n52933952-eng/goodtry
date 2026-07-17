import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  Pressable,
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
import { useTheme } from '../context/ThemeContext';
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
  /** Navigate to a user profile when a blue name is pressed. */
  onUserPress?: (username: string) => void;
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
  onUserPress,
}) => {
  const { user } = useUser();
  const { socket } = useSocket();
  const { colors, theme } = useTheme();
  const showToast = useShowToast();
  
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  /** Blocks row press when a blue name was just tapped (RN parent Pressable otherwise wins). */
  const namePressLockRef = useRef(false);
  const pressedRowBg =
    theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';

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

  const openUserProfile = (username?: string | null) => {
    const u = typeof username === 'string' ? username.trim() : '';
    if (!u || !onUserPress) return;
    namePressLockRef.current = true;
    onUserPress(u);
    // Clear after the row's onPress would have fired (same tick / next).
    setTimeout(() => {
      namePressLockRef.current = false;
    }, 80);
  };

  /** Blue pressable names — separate Pressables so they don't open the post. */
  const renderActivityText = (activity: Activity) => {
    const actorName = activity.userId?.name || activity.userId?.username || 'Someone';
    const actorUsername = activity.userId?.username;
    const targetName =
      activity.targetUser?.name || activity.targetUser?.username || 'someone';
    const targetUsername = activity.targetUser?.username;
    const nameColor = colors.primary;
    const bodyColor = colors.cardText;

    const Name = ({
      label,
      username,
    }: {
      label: string;
      username?: string;
    }) => (
      <Pressable
        onPressIn={() => {
          namePressLockRef.current = true;
        }}
        onPress={() => openUserProfile(username)}
        hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      >
        <Text style={[styles.activityName, { color: nameColor }]}>{label}</Text>
      </Pressable>
    );

    const Rest = ({ children }: { children: string }) => (
      <Text style={[styles.activityTextPart, { color: bodyColor }]}>{children}</Text>
    );

    switch (activity.type) {
      case 'like':
        return (
          <View style={styles.activityTextRow}>
            <Name label={actorName} username={actorUsername} />
            <Rest> liked a post</Rest>
          </View>
        );
      case 'comment':
        return (
          <View style={styles.activityTextRow}>
            <Name label={actorName} username={actorUsername} />
            <Rest> commented on a post</Rest>
          </View>
        );
      case 'follow':
        return (
          <View style={styles.activityTextRow}>
            <Name label={actorName} username={actorUsername} />
            <Rest> started following </Rest>
            <Name label={targetName} username={targetUsername} />
          </View>
        );
      case 'post':
        return (
          <View style={styles.activityTextRow}>
            <Name label={actorName} username={actorUsername} />
            <Rest> created a new post</Rest>
          </View>
        );
      case 'reply':
        return (
          <View style={styles.activityTextRow}>
            <Name label={actorName} username={actorUsername} />
            <Rest> replied to a comment</Rest>
          </View>
        );
      default:
        return (
          <View style={styles.activityTextRow}>
            <Name label={actorName} username={actorUsername} />
            <Rest> performed an action</Rest>
          </View>
        );
    }
  };

  const handleActivityPress = (activity: Activity) => {
    if (namePressLockRef.current) {
      namePressLockRef.current = false;
      return;
    }
    if (onActivityClick) {
      onActivityClick(activity);
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
    <Pressable
      style={({ pressed }) => [
        styles.activityItem,
        {
          backgroundColor: pressed ? pressedRowBg : colors.cardBg,
          borderColor: colors.border,
        },
      ]}
      android_ripple={{
        color: theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)',
        borderless: false,
      }}
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
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
            <Text style={styles.avatarText}>
              {item.userId?.name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
        )}
        
        <View style={styles.activityTextContainer}>
          {renderActivityText(item)}
          <Text style={[styles.activityTime, { color: colors.cardText, opacity: 0.6 }]}>{formatTimeAgo(item.createdAt)}</Text>
        </View>
      </View>
      
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={(e) => handleDeleteActivity(item._id, e)}
        activeOpacity={0.6}
      >
        <Text style={styles.deleteButtonText}>🗑️</Text>
      </TouchableOpacity>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Live Activity</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={[styles.closeButtonText, { color: colors.text }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : activities.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>🔴</Text>
              <Text style={[styles.emptyText, { color: colors.text }]}>No recent activity</Text>
              <Text style={[styles.emptySubtext, { color: colors.textGray }]}>
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
    paddingHorizontal: 10,
    paddingTop: 8,
  },
  activityItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
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
  activityTextRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginBottom: 4,
    direction: 'ltr',
  },
  activityText: {
    fontSize: 15,
    color: COLORS.text,
    fontWeight: '600',
    marginBottom: 4,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  activityTextPart: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  activityName: {
    fontSize: 15,
    fontWeight: '700',
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
