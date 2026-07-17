import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import { API_URL, COLORS, ENDPOINTS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { useShowToast } from '../../hooks/useShowToast';
import { useLanguage } from '../../context/LanguageContext';
import { useFocusEffect } from '@react-navigation/native';
import { useTabBarCollapse } from '../../context/TabBarCollapseContext';

interface NotificationsScreenProps {
  navigation: any;
}

/** Keep name + action on the left (LTR) even when the name is Arabic. */
const NOTIF_LTR = {
  textAlign: 'left' as const,
  writingDirection: 'ltr' as const,
};

const NotificationsScreen: React.FC<NotificationsScreenProps> = ({ navigation }) => {
  const { user } = useUser();
  const { socket, notificationCount, setNotificationCount, refreshNotificationCount } = useSocket();
  const { colors, theme } = useTheme();
  const showToast = useShowToast();
  const { t } = useLanguage();
  const { tabBarHeight } = useTabBarCollapse();
  const pressedRowBg =
    theme === 'dark' ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.10)';
  
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const notifCursorRef = useRef<string | null>(null);
  const isFetchingRef = useRef(false);
  const lastLoadMoreTimeRef = useRef(0);
  const LOAD_MORE_DEBOUNCE_MS = 1500;
  const NOTIFICATION_PAGE_LIMIT = 12;

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

  const fetchNotifications = async (loadMore = false) => {
    if (isFetchingRef.current) return;
    if (loadMore && (!hasMore || loadingMore)) return;
    if (loadMore && notifications.length === 0) return;

    isFetchingRef.current = true;

    try {
      let url = `${ENDPOINTS.GET_NOTIFICATIONS}?limit=${NOTIFICATION_PAGE_LIMIT}`;
      if (loadMore) {
        const token = notifCursorRef.current;
        if (!token) {
          isFetchingRef.current = false;
          setLoadingMore(false);
          return;
        }
        url += `&cursor=${encodeURIComponent(token)}`;
      } else {
        notifCursorRef.current = null;
      }

      const data = await apiService.get(url);
      const page = Array.isArray(data?.notifications) ? data.notifications : [];
      const responseHasMore = data?.hasMore === true;

      if (data?.nextCursor != null && String(data.nextCursor).trim() !== '') {
        notifCursorRef.current = String(data.nextCursor);
      } else {
        notifCursorRef.current = null;
      }

      if (loadMore) {
        setNotifications(prev => {
          const seen = new Set(prev.map(n => n._id));
          const merged = [...prev];
          for (const n of page) {
            if (n?._id && !seen.has(n._id)) {
              seen.add(n._id);
              merged.push(n);
            }
          }
          return merged;
        });
        setLoadingMore(false);
      } else {
        setNotifications(page);
      }

      setHasMore(responseHasMore);

      if (typeof data?.unreadCount === 'number') {
        setNotificationCount(data.unreadCount);
      } else if (!loadMore) {
        await refreshNotificationCount();
      }
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      isFetchingRef.current = false;
      if (!loadMore) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  const handleLoadMore = () => {
    if (notifications.length === 0) return;
    if (!loadingMore && hasMore && !isFetchingRef.current) {
      const now = Date.now();
      if (now - lastLoadMoreTimeRef.current < LOAD_MORE_DEBOUNCE_MS) return;
      lastLoadMoreTimeRef.current = now;
      setLoadingMore(true);
      fetchNotifications(true);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await apiService.put(`${ENDPOINTS.GET_NOTIFICATIONS}/${notificationId}/read`);
      const notification = notifications.find(n => n._id === notificationId);
      setNotifications(prev =>
        prev.map(n => n._id === notificationId ? { ...n, read: true } : n)
      );
      if (notification && !notification.read) {
        setNotificationCount(prev => Math.max(0, prev - 1));
      }
      await refreshNotificationCount();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const markAllAsRead = async () => {
    try {
      const unreadNotifications = notifications.filter(n => !n.read);
      
      if (unreadNotifications.length === 0) {
        showToast(t('info') || 'Info', t('allNotificationsRead') || 'All notifications are already read', 'info');
        return;
      }

      await apiService.put(ENDPOINTS.MARK_ALL_NOTIFICATIONS_READ);
      
      setNotifications(prev =>
        prev.map(n => ({ ...n, read: true }))
      );
      
      setNotificationCount(0);
      await refreshNotificationCount();
      
      showToast(t('success') || 'Success', t('allNotificationsMarkedAsRead') || 'All notifications marked as read', 'success');
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      showToast(t('error') || 'Error', t('failedToMarkAllAsRead') || 'Failed to mark all as read', 'error');
    }
  };

  const handleDeleteNotification = async (notificationId: string, e: any) => {
    e.stopPropagation();
    
    try {
      await apiService.delete(`${ENDPOINTS.GET_NOTIFICATIONS}/${notificationId}`);
      const deleted = notifications.find(n => n._id === notificationId);
      setNotifications(prev => prev.filter(n => n._id !== notificationId));
      
      if (deleted && !deleted.read) {
        setNotificationCount(prev => Math.max(0, prev - 1));
      }
      await refreshNotificationCount();
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
      navigation.navigate('UserProfile', {
        username: notification.from?.username || notification.from?.name || 'user',
        fromScreen: 'Notifications',
      });
    } else if (
      notification.type === 'comment' || 
      notification.type === 'mention' || 
      notification.type === 'like' || 
      notification.type === 'collaboration' || 
      notification.type === 'post_edit' ||
      notification.type === 'capsule_opened'
    ) {
      // Navigate to post detail page (matching web: /${postOwner}/post/${postId})
      if (notification.post && notification.post._id) {
        navigation.navigate('PostDetail', {
          postId: notification.post._id,
          fromScreen: 'Notifications',
        });
      } else if (notification.metadata?.postId || notification.post?._id) {
        const postId = notification.metadata?.postId || notification.post?._id;
        navigation.navigate('PostDetail', {
          postId,
          fromScreen: 'Notifications',
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
    setHasMore(true);
    notifCursorRef.current = null;
    fetchNotifications(false);
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
      case 'capsule_opened': return '⏰';
      default: return '🔔';
    }
  };

  const getNotificationFromName = (notification: any) =>
    notification.from?.name || notification.from?.username || t('someone');

  /** Action text only (name is rendered separately for stable LTR layout). */
  const getNotificationActionText = (notification: any) => {
    switch (notification.type) {
      case 'like':
        return notification.comment ? t('likedYourComment') : t('likedYourPost');
      case 'comment':
        return t('commentedOnYourPost');
      case 'mention':
        return t('mentionedYouInAComment');
      case 'follow':
        return t('startedFollowingYou');
      case 'chess_challenge':
        return t('challengedYouToAChessGame');
      case 'message':
        return t('sentYouAMessage');
      case 'collaboration': {
        const postText = notification.metadata?.postText || 'a collaborative post';
        return `${t('addedYouAsAContributor')} "${postText}"`;
      }
      case 'post_edit': {
        const editedPostText = notification.metadata?.postText || 'your collaborative post';
        return `${t('edited')} "${editedPostText}"`;
      }
      case 'capsule_opened':
        return t('capsuleOpenedText') || 'Your reminder is ready. Tap to open the post.';
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

  const renderNotification = ({ item }: { item: any }) => {
    const fromName = getNotificationFromName(item);
    const actionText = getNotificationActionText(item);
    const useSplitName = item.type !== 'capsule_opened' && !!item.from;
    const idleBg = !item.read ? colors.cardBg : colors.backgroundLight;

    return (
    <Pressable
      style={({ pressed }) => [
        styles.notificationItem,
        {
          backgroundColor: pressed ? pressedRowBg : idleBg,
          borderColor: colors.border,
        },
      ]}
      android_ripple={{
        color: theme === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)',
        borderless: false,
      }}
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
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
              <Text style={styles.avatarText}>
                {item.from?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          
          <View style={styles.textContainer}>
            {useSplitName ? (
              <Text
                style={[
                  styles.notificationText,
                  NOTIF_LTR,
                  { color: !item.read ? colors.cardText : colors.text },
                ]}
                numberOfLines={3}
              >
                <Text style={[styles.notificationName, NOTIF_LTR]}>{fromName}</Text>
                <Text style={NOTIF_LTR}>{' '}{actionText}</Text>
              </Text>
            ) : (
              <Text
                style={[
                  styles.notificationText,
                  NOTIF_LTR,
                  { color: !item.read ? colors.cardText : colors.text },
                ]}
                numberOfLines={3}
              >
                {actionText}
              </Text>
            )}
            {item.type === 'capsule_opened' && item.post?.text ? (
              <Text
                style={[
                  styles.commentText,
                  NOTIF_LTR,
                  { color: !item.read ? colors.cardText : colors.textGray },
                ]}
                numberOfLines={2}
              >
                "{item.post.text}"
              </Text>
            ) : null}
            {item.comment && (
              <Text
                style={[
                  styles.commentText,
                  NOTIF_LTR,
                  { color: !item.read ? colors.cardText : colors.textGray },
                ]}
                numberOfLines={2}
              >
                "{item.comment}"
              </Text>
            )}
            <Text
              style={[
                styles.notificationTime,
                NOTIF_LTR,
                { color: !item.read ? colors.cardText : colors.textGray },
              ]}
            >
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
    </Pressable>
  );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('notifications')}</Text>
        {unreadCount > 0 && (
          <TouchableOpacity
            style={[styles.markAllButton, { backgroundColor: colors.primary }]}
            onPress={markAllAsRead}
          >
            <Text style={[styles.markAllButtonText, { color: colors.buttonText }]}>{t('markAllAsRead') || 'Mark All Read'}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={notifications}
        renderItem={renderNotification}
        keyExtractor={(item) => item._id}
        contentContainerStyle={[
          styles.listContainer,
          { paddingBottom: 28 + tabBarHeight },
        ]}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoader}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>🔔</Text>
            <Text style={[styles.emptyText, { color: colors.text }]}>{t('noNotifications')}</Text>
            <Text style={[styles.emptySubtext, { color: colors.textGray }]}>
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
    paddingHorizontal: 10,
    paddingTop: 8,
    flexGrow: 1,
  },
  footerLoader: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  notificationItem: {
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
  unreadNotification: {
    backgroundColor: COLORS.backgroundLight,
  },
  notificationContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    direction: 'ltr',
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
    alignItems: 'flex-start',
    direction: 'ltr',
  },
  notificationText: {
    fontSize: 15,
    color: COLORS.text,
    marginBottom: 4,
    fontWeight: '600',
    alignSelf: 'stretch',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  notificationName: {
    fontWeight: '700',
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
