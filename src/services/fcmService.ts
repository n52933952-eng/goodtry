/**
 * Firebase Cloud Messaging — token registration, call-related foreground events,
 * and social / message notifications (replaces OneSignal).
 * Native MyFirebaseMessagingService still handles incoming_call when app is killed.
 */

import messaging from '@react-native-firebase/messaging';
import { DeviceEventEmitter, Alert, Platform, PermissionsAndroid } from 'react-native';
import { apiService } from './api';
import { navigateFromPushData } from './pushNavigation';

class FCMService {
  private fcmToken: string | null = null;
  private isInitialized = false;
  private navigationRef: { current: any } | null = null;
  /** save-fcm-token is behind protectRoute — only POST after login (cookie exists). */
  private allowBackendSync = false;

  setNavigationRef(ref: { current: any } | null) {
    this.navigationRef = ref;
  }

  /** Call from UserContext when user logs in / restores session; false on logout. */
  setAllowBackendSync(allow: boolean) {
    this.allowBackendSync = allow;
  }

  /** After login: register device token with API (requires jwt cookie). */
  async syncTokenWithBackend(): Promise<void> {
    if (!this.allowBackendSync) return;
    try {
      let token = this.fcmToken;
      if (!token) {
        try {
          token = await messaging().getToken();
        } catch {
          return;
        }
        if (token) this.fcmToken = token;
      }
      if (!token) return;
      await this.sendTokenToBackend(token);
    } catch (e) {
      console.warn('⚠️ [FCM] syncTokenWithBackend skipped/failed:', e);
    }
  }

  async initialize() {
    if (this.isInitialized) {
      console.log('✅ FCM already initialized');
      return;
    }

    try {
      console.log('🔥 [FCM] Initializing Firebase Cloud Messaging...');

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

      // Android 13+ (API 33): system notification permission — shows the "Allow notifications?" dialog
      // the first time the app requests it (not on every app open if already answered).
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        try {
          const post =
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS ??
            'android.permission.POST_NOTIFICATIONS';
          const result = await PermissionsAndroid.request(post as never);
          if (result !== PermissionsAndroid.RESULTS.GRANTED) {
            console.warn('⚠️ [FCM] POST_NOTIFICATIONS denied — calls/messages may not alert');
            return;
          }
        } catch (e) {
          console.warn('⚠️ [FCM] POST_NOTIFICATIONS request failed:', e);
        }
      }

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

      const token = await messaging().getToken();
      this.fcmToken = token;
      console.log('🔥 [FCM] Token:', token);
      // Do not POST here — no jwt until user logs in (would 401 + trigger api logout).

      messaging().onTokenRefresh(async (newToken) => {
        console.log('🔥 [FCM] Token refreshed:', newToken);
        this.fcmToken = newToken;
        if (this.allowBackendSync) {
          await this.sendTokenToBackend(newToken);
        }
      });

      this.setupForegroundHandler();
      this.setupNotificationOpenedHandlers();

      this.isInitialized = true;
      if (this.allowBackendSync && this.fcmToken) {
        await this.sendTokenToBackend(this.fcmToken);
      }
      console.log('✅ [FCM] Initialized successfully');
    } catch (error: any) {
      console.error('❌ [FCM] Initialization error:', error);
      throw error;
    }
  }

  private async sendTokenToBackend(token: string) {
    if (!this.allowBackendSync) return;
    try {
      await apiService.post('/api/user/save-fcm-token', {
        fcmToken: token,
      });
      console.log('✅ [FCM] Token saved to backend');
    } catch (error) {
      console.error('❌ [FCM] Error saving token to backend:', error);
    }
  }

  private setupNotificationOpenedHandlers() {
    messaging().onNotificationOpenedApp((remoteMessage) => {
      const data = remoteMessage?.data as Record<string, string> | undefined;
      if (!data?.type) return;
      if (data.type === 'incoming_call' || data.type === 'call_ended') return;
      if (this.navigationRef?.current) {
        navigateFromPushData(this.navigationRef, data);
      }
    });
  }

  /**
   * Cold start: user tapped a notification that launched the app.
   */
  async flushInitialNotification() {
    try {
      const remoteMessage = await messaging().getInitialNotification();
      const data = remoteMessage?.data as Record<string, string> | undefined;
      if (!data?.type || !this.navigationRef?.current) return;
      if (data.type === 'incoming_call') return;
      navigateFromPushData(this.navigationRef, data);
    } catch (e) {
      console.warn('[FCM] flushInitialNotification', e);
    }
  }

  private setupForegroundHandler() {
    messaging().onMessage(async (remoteMessage) => {
      console.log('🔥 [FCM] Foreground message:', remoteMessage);
      console.log('🔥 [FCM] Message data:', remoteMessage.data);

      const data = remoteMessage.data as Record<string, string> | undefined;
      if (data?.type === 'incoming_call') {
        console.log('📞 [FCM] Incoming call in foreground — socket/WebRTC handles UI');
        return;
      }
      if (
        data?.type === 'call_ended' ||
        data?.type === 'call_canceled' ||
        data?.type === 'call_cancelled'
      ) {
        const callerId = (data?.callerId || data?.sender || data?.from || '').toString();
        console.log('📴 [FCM] Call ended/canceled in foreground', { callerId, action: data?.action });
        DeviceEventEmitter.emit('CallEndedFromFCM', { callerId, data });
        return;
      }

      if (data?.type === 'message') {
        const title = remoteMessage.notification?.title || data.title || 'Message';
        const body = remoteMessage.notification?.body || data.body || '';
        if (title || body) {
          Alert.alert(title || 'Message', body || '');
        }
        return;
      }

      if (data?.type) {
        console.log('🔔 [FCM] Social/activity push in foreground, type:', data.type);
      }
    });
  }

  getToken(): string | null {
    return this.fcmToken;
  }
}

export default new FCMService();
