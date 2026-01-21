/**
 * OneSignal Push Notification Service
 * Handles non-call push notifications (likes, comments, follows, chess, etc.)
 * Note: Call notifications are handled by FCM service
 */

import { OneSignal } from 'react-native-onesignal';
import { Platform, PermissionsAndroid } from 'react-native';

// OneSignal App ID (from backend configuration)
const ONESIGNAL_APP_ID = '63af553f-4dfb-449d-9f22-38d6e006094b';

class OneSignalService {
  private navigationRef: any = null;
  private isInitialized = false;
  private pendingNotification: any = null; // Store notification click if navigation ref not ready

  setNavigationRef(ref: any) {
    this.navigationRef = ref;
    console.log('✅ [OneSignal] Navigation ref set');
    
    // Process pending notification if any
    if (this.pendingNotification && this.navigationRef) {
      console.log('📩 [OneSignal] Processing pending notification...');
      const pendingData = this.pendingNotification;
      this.pendingNotification = null; // Clear pending
      // Small delay to ensure navigation is fully ready
      setTimeout(() => {
        this.handleNotificationAction(pendingData);
      }, 300);
    }
  }

  async initialize() {
    console.log('🔔 [OneSignal] Initializing OneSignal...');

    // Check if OneSignal methods are available
    if (!OneSignal || !OneSignal.initialize) {
      console.warn('⚠️ [OneSignal] OneSignal is not available. Native module may not be linked properly.');
      return;
    }

    try {
      // OneSignal v5: Initialize from JavaScript
      console.log('🔔 [OneSignal] Calling OneSignal.initialize()...');
      OneSignal.initialize(ONESIGNAL_APP_ID);

      // Enable verbose logging for debugging (disable in production)
      if (__DEV__) {
        OneSignal.Debug.setLogLevel(6); // 6 = Verbose
      }

      console.log('✅ [OneSignal] OneSignal.initialize() completed');
      this.isInitialized = true;

      // Request notification permission (Android 13+ requires runtime permission)
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        console.log('🔔 [OneSignal] Android 13+: Requesting POST_NOTIFICATIONS permission...');
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
        console.log('🔔 [OneSignal] POST_NOTIFICATIONS permission result:', granted);
      }

      // Request notification permission
      console.log('🔔 [OneSignal] Requesting OneSignal notification permission...');
      const permissionGranted = await OneSignal.Notifications.requestPermission(true);
      console.log('✅ [OneSignal] Permission granted:', permissionGranted);

      // Notification received while app is in foreground
      OneSignal.Notifications.addEventListener('foregroundWillDisplay', (event) => {
        console.log('📩 [OneSignal] Notification received in foreground');
        const notification = event.getNotification();
        const data = notification.additionalData;

        // Skip call notifications (handled by FCM)
        if (data?.type === 'call') {
          console.log('📞 [OneSignal] Call notification - skipping (handled by FCM)');
          notification.display(); // Still display but FCM will handle the UI
          return;
        }

        // Display other notifications
        notification.display();
      });

      // Notification received in background (when app is closed or in background)
      OneSignal.Notifications.addEventListener('received', (event) => {
        console.log('📩 [OneSignal] Notification received (background/closed)');
        const notification = event.notification;
        const data = notification.additionalData;

        // Skip call notifications (handled by FCM)
        if (data?.type === 'call') {
          console.log('📞 [OneSignal] Call notification - skipping (handled by FCM)');
          return;
        }
      });

      // Notification clicked/opened
      OneSignal.Notifications.addEventListener('click', (event) => {
        console.log('👆 [OneSignal] Notification clicked');
        const notification = event.notification;
        const data = notification.additionalData;
        const result = event.result; // Contains button click info if action button was clicked

        if (data) {
          // Skip call notifications (handled by FCM)
          if (data.type === 'call') {
            console.log('📞 [OneSignal] Call notification clicked - handled by FCM');
            return;
          }

          // Handle action button clicks (Reply, Mark as read, etc.)
          if (result?.actionId) {
            console.log('🔘 [OneSignal] Action button clicked:', result.actionId);
            this.handleActionButton(result.actionId, data);
            return;
          }

          // If navigation ref is not ready, store the notification for later
          if (!this.navigationRef) {
            console.log('⏳ [OneSignal] Navigation ref not ready - storing notification for later');
            this.pendingNotification = data;
            return;
          }

          // Navigation ref is ready, handle immediately
          this.handleNotificationAction(data);
        }
      });

      console.log('✅ [OneSignal] OneSignal initialized successfully');
    } catch (error) {
      console.error('❌ [OneSignal] Error initializing OneSignal:', error);
    }
  }

  // Link user ID to OneSignal (for targeted notifications)
  async setUserId(userId: string) {
    if (!this.isInitialized) {
      console.warn('⚠️ [OneSignal] OneSignal not initialized yet, waiting...');
      setTimeout(() => this.setUserId(userId), 1000);
      return;
    }

    if (!OneSignal || !OneSignal.login) {
      console.warn('⚠️ [OneSignal] OneSignal not available, cannot link user');
      return;
    }

    try {
      console.log('🔗 [OneSignal] Linking user to OneSignal:', userId);
      OneSignal.login(userId);
      console.log('✅ [OneSignal] User linked to OneSignal');

      // Log subscription info
      setTimeout(async () => {
        try {
          const pushSubscription = OneSignal.User.pushSubscription;
          const subscriptionId = pushSubscription.getPushSubscriptionId();
          const optedIn = pushSubscription.getOptedIn();
          console.log('📱 [OneSignal] Subscription ID:', subscriptionId);
          console.log('📱 [OneSignal] Opted In:', optedIn);
          console.log('📱 [OneSignal] External User ID:', userId);
        } catch (e) {
          console.error('❌ [OneSignal] Error getting subscription info:', e);
        }
      }, 2000);
    } catch (error) {
      console.error('❌ [OneSignal] Error linking user to OneSignal:', error);
    }
  }

  // Unlink user when logging out
  async removeUserId() {
    if (!OneSignal || !OneSignal.logout) {
      return;
    }
    try {
      console.log('🔓 [OneSignal] Unlinking user from OneSignal');
      OneSignal.logout();
      console.log('✅ [OneSignal] User unlinked from OneSignal');
    } catch (error) {
      console.error('❌ [OneSignal] Error unlinking user from OneSignal:', error);
    }
  }

  // Get OneSignal player ID
  async getPlayerId(): Promise<string | null> {
    if (!OneSignal || !OneSignal.User) {
      return null;
    }
    try {
      const pushSubscription = OneSignal.User.pushSubscription;
      return pushSubscription.getPushSubscriptionId() || null;
    } catch (error) {
      console.error('❌ [OneSignal] Error getting player ID:', error);
      return null;
    }
  }

  // Handle action button clicks (Reply, Mark as read, etc.)
  private handleActionButton(actionId: string, data: any) {
    console.log('🔘 [OneSignal] Handling action button:', actionId);
    
    if (!this.navigationRef) {
      console.warn('⚠️ [OneSignal] Navigation ref not set for action button');
      return;
    }

    switch (actionId) {
      case 'view_post':
        // Navigate to post
        const postId = data.postId || data.post?._id || data.metadata?.postId;
        if (postId) {
          this.navigationRef.navigate('Feed', {
            screen: 'PostDetail',
            params: { postId: postId.toString() }
          });
        }
        break;
      
      case 'view_profile':
        // Navigate to user profile
        if (data.userId) {
          this.navigationRef.navigate('UserProfile', {
            userId: data.userId,
          });
        }
        break;
      
      case 'mark_read':
        // Mark notification as read (you can call an API endpoint here)
        console.log('✅ [OneSignal] Marking notification as read');
        // TODO: Call API to mark notification as read if needed
        break;
      
      default:
        console.log('⚠️ [OneSignal] Unknown action button:', actionId);
    }
  }

  // Handle notification actions (navigation, etc.)
  // This matches the behavior of NotificationsScreen.handleNotificationPress
  private handleNotificationAction(data: any) {
    console.log('📩 [OneSignal] Handling notification action:', data);
    console.log('📩 [OneSignal] Notification data:', JSON.stringify(data, null, 2));

    if (!this.navigationRef) {
      console.warn('⚠️ [OneSignal] Navigation ref not set - storing notification for later');
      // Store for processing when navigation ref is ready
      this.pendingNotification = data;
      return;
    }

    // Handle different notification types (matching NotificationsScreen behavior)
    if (data.type === 'follow') {
      // Navigate to user profile
      console.log('👥 [OneSignal] Navigating to user profile');
      if (data.userId) {
        // For follow notifications, userId is the follower's ID
        // We need to navigate to their profile - but we don't have username
        // Try to navigate using userId, or we could fetch username first
        this.navigationRef.navigate('UserProfile', {
          userId: data.userId,
        });
      }
    } else if (
      data.type === 'like' || 
      data.type === 'comment' || 
      data.type === 'mention' || 
      data.type === 'collaboration' || 
      data.type === 'post_edit'
    ) {
      // Navigate to post detail page (matching NotificationsScreen behavior)
      console.log(`📱 [OneSignal] Navigating to post (type: ${data.type})`);
      
      // postId can be in data.postId (from backend push notification)
      const postId = data.postId || data.post?._id || data.metadata?.postId;
      
      if (postId) {
        console.log(`✅ [OneSignal] Navigating to PostDetail with postId: ${postId}`);
        // Navigate to Feed tab first, then to PostDetail (nested navigation)
        this.navigationRef.navigate('Feed', {
          screen: 'PostDetail',
          params: { postId: postId.toString() }
        });
      } else {
        console.error('❌ [OneSignal] No postId found in notification data:', data);
      }
    } else if (data.type === 'chess_challenge' || data.type === 'chess_move') {
      // Chess notification
      console.log('♟️ [OneSignal] Navigating to chess game');
      if (data.gameId || data.roomId) {
        this.navigationRef.navigate('ChessGame', {
          roomId: data.gameId || data.roomId,
        });
      }
    } else if (data.type === 'message') {
      // New message notification
      console.log('💬 [OneSignal] Navigating to chat');
      // Mobile ChatScreen fetches messages by otherUserId (userId param), so include senderId
      const senderId = data.senderId || data.userId || data.fromUserId;
      if (senderId) {
        this.navigationRef.navigate('ChatScreen', {
          // conversationId is optional, but helps mark seen
          conversationId: data.conversationId,
          userId: senderId,
          otherUser: {
            _id: senderId,
            name: data.senderName,
            username: data.senderUsername,
            profilePic: data.senderProfilePic,
          },
        });
      } else {
        // Fallback to Messages screen
        this.navigationRef.navigate('Messages');
      }
    } else {
      console.warn(`⚠️ [OneSignal] Unknown notification type: ${data.type}`);
    }
  }

  // Subscribe to tags (for targeted notifications)
  async sendTag(key: string, value: string) {
    if (!OneSignal || !OneSignal.User) {
      return;
    }
    try {
      OneSignal.User.addTag(key, value);
      console.log(`✅ [OneSignal] Tag sent: ${key} = ${value}`);
    } catch (error) {
      console.error('❌ [OneSignal] Error sending tag:', error);
    }
  }

  // Delete tag
  async deleteTag(key: string) {
    if (!OneSignal || !OneSignal.User) {
      return;
    }
    try {
      OneSignal.User.removeTag(key);
      console.log(`✅ [OneSignal] Tag deleted: ${key}`);
    } catch (error) {
      console.error('❌ [OneSignal] Error deleting tag:', error);
    }
  }
}

export default new OneSignalService();
