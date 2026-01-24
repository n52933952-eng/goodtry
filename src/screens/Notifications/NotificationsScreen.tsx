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
  Alert,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useLanguage } from '../../context/LanguageContext';
import { useFocusEffect } from '@react-navigation/native';

interface NotificationsScreenProps {
  navigation: any;
}

const NotificationsScreen: React.FC<NotificationsScreenProps> = ({ navigation }) => {
  const { user } = useUser();
  const { socket, notificationCount, setNotificationCount } = useSocket();
  const showToast = useShowToast();
  const { t } = useLanguage();
  
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchNotifications();
  }, []);

  // Sync notification count when screen comes into focus
  // This ensures the count is always accurate from the server
  useFocusEffect(
    React.useCallback(() => {
      // Re-fetch notifications to sync count with server
      fetchNotifications();
    }, [])
  );

  // Listen for new notifications via socket
  useEffect(() => {
    if (!socket) return;

    const handleNewNotification = (notification: any) => {
      console.log('🔔 New notification received on notifications page:', notification);
      // Check if notification already exists (prevent duplicates)
      setNotifications(prev => {
        const exists = prev.some(n => n._id === notification._id);
        if (exists) {
          console.log('🔔 [NotificationsScreen] Notification already exists, skipping');
          return prev;
        }
        return [notification, ...prev];
      });
      // Don't increment count here - SocketContext already handles it
      // This prevents double counting
    };

    const handleNotificationDeleted = (data: any) => {
      console.log('🗑️ Notification deleted via socket:', data);
      // Remove follow notifications from the specified user
      if (data.type === 'follow' && data.from) {
        setNotifications(prev => {
          const filtered = prev.filter(n => 
            !(n.type === 'follow' && n.from?._id?.toString() === data.from && !n.read)
          );
          // Update count if we removed any unread notifications
          const removedCount = prev.length - filtered.length;
          if (removedCount > 0 && setNotificationCount) {
            setNotificationCount(prevCount => Math.max(0, prevCount - removedCount));
          }
          return filtered;
        });
      }
    };

    socket.on('newNotification', handleNewNotification);
    socket.on('notificationDeleted', handleNotificationDeleted);

    return () => {
      socket.off('newNotification', handleNewNotification);
      socket.off('notificationDeleted', handleNotificationDeleted);
    };
  }, [socket, setNotificationCount]);

  const fetchNotifications = async () => {
    try {
      const baseUrl = API_URL;
      const response = await fetch(`${baseUrl}/api/notification`, {
        credentials: 'include',
      });
      const data = await response.json();
      
      if (response.ok && data.notifications) {
        setNotifications(Array.isArray(data.notifications) ? data.notifications : []);
        // Update notification count from server
        if (setNotificationCount && data.unreadCount !== undefined) {
          setNotificationCount(data.unreadCount);
        }
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      const baseUrl = API_URL;
      await fetch(`${baseUrl}/api/notification/${notificationId}/read`, {
        method: 'PUT',
        credentials: 'include',
      });
      
      const notification = notifications.find(n => n._id === notificationId);
      setNotifications(prev =>
        prev.map(n => n._id === notificationId ? { ...n, read: true } : n)
      );
      // Decrement count if notification was unread
      if (notification && !notification.read && setNotificationCount) {
        setNotificationCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const baseUrl = API_URL;
      const unreadNotifications = notifications.filter(n => !n.read);
      
      if (unreadNotifications.length === 0) {
        showToast(t('info') || 'Info', t('allNotificationsRead') || 'All notifications are already read', 'info');
        return;
      }

      // Mark all unread notifications as read
      const promises = unreadNotifications.map(notification =>
        fetch(`${baseUrl}/api/notification/${notification._id}/read`, {
          method: 'PUT',
          credentials: 'include',
        })
      );

      await Promise.all(promises);
      
      // Update all notifications to read
      setNotifications(prev =>
        prev.map(n => ({ ...n, read: true }))
      );
      
      // Reset notification count to 0
      if (setNotificationCount) {
        setNotificationCount(0);
      }
      
      showToast(t('success') || 'Success', t('allNotificationsMarkedAsRead') || 'All notifications marked as read', 'success');
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      showToast(t('error') || 'Error', t('failedToMarkAllAsRead') || 'Failed to mark all as read', 'error');
    }
  };

  const handleDeleteNotification = async (notificationId: string, e: any) => {
    e.stopPropagation(); // Prevent triggering the click handler
    
    try {
      const baseUrl = API_URL;
      const res = await fetch(`${baseUrl}/api/notification/${notificationId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        // Remove from local state
        const deleted = notifications.find(n => n._id === notificationId);
        setNotifications(prev => prev.filter(n => n._id !== notificationId));
        
        // Update count if notification was unread
        if (deleted && !deleted.read && setNotificationCount) {
          setNotificationCount(prev => Math.max(0, prev - 1));
        }
      }
    } catch (error) {
      console.error('Error deleting notification:', error);
      showToast('Error', 'Failed to delete notification', 'error');
    }
  };

  const handleNotificationPress = (notification: any) => {
    // Don't navigate if delete button was clicked
    if (notification._skipNavigation) return;
    
    // Mark as read if not already read (like web does)
    if (!notification.read) {
      markAsRead(notification._id);
    }
    
    // Navigate based on notification type (matching web behavior)
    if (notification.type === 'follow') {
      // Navigate to user profile
      navigation.navigate('UserProfile', { 
        username: notification.from?.username || notification.from?.name || 'user' 
      });
    } else if (
      notification.type === 'comment' || 
      notification.type === 'mention' || 
      notification.type === 'like' || 
      notification.type === 'collaboration' || 
      notification.type === 'post_edit'
    ) {
      // Navigate to post detail page (matching web: /${postOwner}/post/${postId})
      if (notification.post && notification.post._id) {
        // Get post owner from populated post
        const postOwner = notification.post.postedBy?.username || notification.post.postedBy?.name || user?.username;
        // Navigate to Feed tab, then to PostDetail (nested navigation to show tab bar)
        navigation.navigate('Feed', {
          screen: 'PostDetail',
          params: { postId: notification.post._id }
        });
      } else if (notification.metadata?.postId || notification.post?._id) {
        // Fallback: try to get postId from metadata or post object
        const postId = notification.metadata?.postId || notification.post?._id;
        const postOwner = notification.post?.postedBy?.username || user?.username;
        navigation.navigate('Feed', {
          screen: 'PostDetail',
          params: { postId }
        });
      }
    } else if (notification.type === 'chess_challenge') {
      navigation.navigate('Chess', { roomId: notification.roomId });
    } else if (notification.type === 'message') {
      navigation.navigate('Messages');
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchNotifications();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'like': return '❤️';
      case 'comment': return '💬';
      case 'mention': return '@';
      case 'follow': return '👤';
      case 'chess_challenge': return '♟️';
      case 'message': return '✉️';
      case 'collaboration': return '🤝';
      case 'post_edit': return '✏️';
      default: return '🔔';
    }
  };

  const getNotificationText = (notification: any) => {
    const fromName = notification.from?.name || notification.from?.username || t('someone');
    
    switch (notification.type) {
      case 'like':
        // Check if it's a comment/reply like (has comment text) or post like
        if (notification.comment) {
          return `${fromName} ${t('likedYourComment')}`;
        } else {
          return `${fromName} ${t('likedYourPost')}`;
        }
      case 'comment':
        return `${fromName} ${t('commentedOnYourPost')}`;
      case 'mention':
        return `${fromName} ${t('mentionedYouInAComment')}`;
      case 'follow':
        return `${fromName} ${t('startedFollowingYou')}`;
      case 'chess_challenge':
        return `${fromName} ${t('challengedYouToAChessGame')}`;
      case 'message':
        return `${fromName} ${t('sentYouAMessage')}`;
      case 'collaboration':
        const postText = notification.metadata?.postText || 'a collaborative post';
        return `${fromName} ${t('addedYouAsAContributor')} "${postText}"`;
      case 'post_edit':
        const editedPostText = notification.metadata?.postText || 'your collaborative post';
        return `${fromName} ${t('edited')} "${editedPostText}"`;
      default:
        return notification.message || t('newNotification');
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t('now');
    if (diffMins < 60) return `${diffMins}m ${t('ago')}`;
    if (diffHours < 24) return `${diffHours}h ${t('ago')}`;
    if (diffDays < 7) return `${diffDays}d ${t('ago')}`;
    return date.toLocaleDateString();
  };

  const renderNotification = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !item.read && styles.unreadNotification,
      ]}
      onPress={() => handleNotificationPress(item)}
    >
      <View style={styles.notificationContent}>
        <View style={styles.iconContainer}>
          <Text style={styles.notificationIcon}>
            {getNotificationIcon(item.type)}
          </Text>
        </View>
        
        <View style={styles.notificationDetails}>
          {item.from?.profilePic ? (
            <Image 
              source={{ uri: item.from.profilePic }} 
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {item.from?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          
          <View style={styles.textContainer}>
            <Text style={styles.notificationText}>
              {getNotificationText(item)}
            </Text>
            {item.comment && (
              <Text style={styles.commentText} numberOfLines={2}>
                "{item.comment}"
              </Text>
            )}
            <Text style={styles.notificationTime}>
              {formatTime(item.createdAt)}
            </Text>
          </View>
        </View>
      </View>
      
      <View style={styles.notificationActions}>
        {!item.read && (
          <>
            <TouchableOpacity
              style={styles.markReadButton}
              onPress={(e) => {
                e.stopPropagation();
                markAsRead(item._id);
              }}
            >
              <Text style={styles.markReadButtonText}>✓</Text>
            </TouchableOpacity>
            <View style={styles.unreadDot} />
          </>
        )}
        <TouchableOpacity
          style={styles.deleteButton}
          onPress={(e) => {
            e.stopPropagation();
            handleDeleteNotification(item._id, e);
          }}
        >
          <Text style={styles.deleteButtonText}>🗑️</Text>
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('notifications')}</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={styles.markAllButton}
            onPress={markAllAsRead}
          >
            <Text style={styles.markAllButtonText}>{t('markAllAsRead') || 'Mark All Read'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item._id}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={styles.emptyText}>{t('noNotifications')}</Text>
            <Text style={styles.emptySubtext}>
              {t('youWillSeeNotifications')}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  markAllButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: COLORS.primary,
  },
  markAllButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
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
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  unreadNotification: {
    backgroundColor: COLORS.backgroundLight,
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    marginRight: 12,
  },
  notificationIcon: {
    fontSize: 24,
  },
  notificationDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
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
  notificationText: {
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 4,
    fontWeight: '600',
  },
  commentText: {
    fontSize: 13,
    color: COLORS.textGray,
    fontStyle: 'italic',
    marginTop: 2,
    marginBottom: 4,
  },
  notificationTime: {
    fontSize: 13,
    color: COLORS.textGray,
  },
  notificationActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  markReadButton: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: COLORS.backgroundLight,
    width: 28,
    height: 28,
    justifyContent: 'center',
    alignItems: 'center',
  },
  markReadButtonText: {
    fontSize: 16,
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  deleteButton: {
    padding: 6,
    borderRadius: 6,
  },
  deleteButtonText: {
    fontSize: 18,
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

export default NotificationsScreen;
