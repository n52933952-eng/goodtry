/**
 * Firebase Cloud Messaging Service
 * Handles FCM push notifications for incoming calls
 * Native MyFirebaseMessagingService handles FCM when app is killed (shows IncomingCallActivity)
 * This service handles token registration and foreground messages
 */

import messaging from '@react-native-firebase/messaging';
import { Platform, AppState } from 'react-native';
import { apiService } from './api';

class FCMService {
  private fcmToken: string | null = null;
  private isInitialized = false;

  /**
   * Initialize FCM and request permissions
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('✅ FCM already initialized');
      return;
    }

    try {
      console.log('🔥 [FCM] Initializing Firebase Cloud Messaging...');

      // Check if Firebase is initialized (it auto-initializes from google-services.json)
      // If this throws, it means Firebase isn't ready yet
      try {
        const test = messaging();
        if (!test) {
          throw new Error('Firebase messaging is not available');
        }
        console.log('✅ [FCM] Firebase messaging is available');
      } catch (firebaseError) {
        console.error('❌ [FCM] Firebase not initialized:', firebaseError);
        console.error('❌ [FCM] Make sure google-services.json is in android/app/ and app is rebuilt');
        throw new Error('Firebase is not initialized. Please rebuild the app after adding google-services.json');
      }

      // Request notification permission
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (enabled) {
        console.log('✅ [FCM] Notification permission granted');
      } else {
        console.warn('⚠️ [FCM] Notification permission denied');
        return;
      }

      // Get FCM token
      const token = await messaging().getToken();
      this.fcmToken = token;
      console.log('🔥 [FCM] Token:', token);

      // Send token to backend
      await this.sendTokenToBackend(token);

      // Listen for token refresh
      messaging().onTokenRefresh(async (newToken) => {
        console.log('🔥 [FCM] Token refreshed:', newToken);
        this.fcmToken = newToken;
        await this.sendTokenToBackend(newToken);
      });

      // Handle foreground messages (when app is open)
      // Note: Native service handles background/killed state
      this.setupForegroundHandler();

      this.isInitialized = true;
      console.log('✅ [FCM] Initialized successfully');
    } catch (error) {
      console.error('❌ [FCM] Initialization error:', error);
      console.error('❌ [FCM] Error message:', error?.message);
      console.error('❌ [FCM] Error stack:', error?.stack);
      console.error('❌ [FCM] Full error:', JSON.stringify(error, null, 2));
      // Re-throw so App.tsx can catch it and retry
      throw error;
    }
  }

  /**
   * Send FCM token to backend
   */
  private async sendTokenToBackend(token: string) {
    try {
      const response = await apiService.post('/api/user/save-fcm-token', {
        fcmToken: token,
      });
      console.log('✅ [FCM] Token saved to backend');
    } catch (error) {
      console.error('❌ [FCM] Error saving token to backend:', error);
    }
  }

  /**
   * Handle notifications when app is in foreground
   * Note: When app is in foreground, socket.io events handle incoming calls
   * This is just for logging - native service handles background/killed state
   */
  private setupForegroundHandler() {
    messaging().onMessage(async (remoteMessage) => {
      console.log('🔥 [FCM] Foreground message:', remoteMessage);
      console.log('🔥 [FCM] Message data:', remoteMessage.data);

      const data = remoteMessage.data;
      if (data?.type === 'incoming_call') {
        console.log('📞 [FCM] Incoming call notification in foreground');
        console.log('📞 [FCM] Caller:', data.callerName);
        console.log('📞 [FCM] Caller ID:', data.callerId);
        console.log('📞 [FCM] Call Type:', data.callType);
        console.log('✅ [FCM] Socket.io will handle this - WebRTCContext will receive callUser event');
      } else {
        console.log('⚠️ [FCM] Not a call notification, type:', data?.type);
      }
    });
  }

  /**
   * Get current FCM token
   */
  getToken(): string | null {
    return this.fcmToken;
  }
}

export default new FCMService();
