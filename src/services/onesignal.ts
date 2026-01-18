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

  setNavigationRef(ref: any) {
    this.navigationRef = ref;
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

        if (data) {
          // Skip call notifications (handled by FCM)
          if (data.type === 'call') {
            console.log('📞 [OneSignal] Call notification clicked - handled by FCM');
            return;
          }

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

  // Handle notification actions (navigation, etc.)
  private handleNotificationAction(data: any) {
    console.log('📩 [OneSignal] Handling notification action:', data);

    if (!this.navigationRef) {
      console.warn('⚠️ [OneSignal] Navigation ref not set');
      return;
    }

    // Handle different notification types
    if (data.type === 'message') {
      // New message notification
      console.log('💬 [OneSignal] Navigating to chat');
      if (data.conversationId) {
        this.navigationRef.navigate('ChatScreen', {
          conversationId: data.conversationId,
        });
      }
    } else if (data.type === 'like' || data.type === 'comment') {
      // Post notifications
      console.log('📱 [OneSignal] Navigating to post');
      if (data.postId) {
        this.navigationRef.navigate('PostDetail', {
          postId: data.postId,
        });
      }
    } else if (data.type === 'chess_challenge' || data.type === 'chess_move') {
      // Chess notification
      console.log('♟️ [OneSignal] Navigating to chess game');
      if (data.gameId) {
        this.navigationRef.navigate('ChessGame', {
          gameId: data.gameId,
        });
      }
    } else if (data.type === 'follow') {
      // Follow notification - navigate to user profile
      console.log('👥 [OneSignal] Navigating to user profile');
      if (data.userId) {
        // You'll need to get username from userId or pass it in data
        this.navigationRef.navigate('UserProfile', {
          userId: data.userId,
        });
      }
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
