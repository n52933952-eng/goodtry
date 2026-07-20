/**
 * Firebase Cloud Messaging — token registration, call-related foreground events,
 * and social / message notifications (replaces OneSignal).
 * Native MyFirebaseMessagingService still handles incoming_call when app is killed.
 */

import messaging from '@react-native-firebase/messaging';
import { DeviceEventEmitter, Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiService } from './api';
import { API_URL, STORAGE_KEYS } from '../utils/constants';
import { stashEarlyChatPush } from './chatPushPrefs';

function normalizeOpenedPushData(data: Record<string, string> | undefined | null): Record<string, string> | null {
  if (!data || typeof data !== 'object') return null;
  const raw: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value == null) continue;
    raw[key] = String(value);
  }
  if (!raw.type && raw.conversationId) {
    raw.type = raw.isGroup === 'true' ? 'group_message' : 'message';
  }
  if (!raw.type) return null;
  return raw;
}

/** Capture native chat-push events before AppNavigator mounts (auth loading returns null). */
DeviceEventEmitter.addListener('NavigateToChatFromPush', (data: any) => {
  stashEarlyChatPush(data);
});
DeviceEventEmitter.addListener('NavigateFromPush', (data: any) => {
  const type = data?.type != null ? String(data.type) : '';
  if (type === 'message' || type === 'group_message' || type === 'group_added' || data?.conversationId) {
    stashEarlyChatPush(data);
  }
});

async function ackDeliveredViaHttp(messageId: string) {
  try {
    const rawUser = await AsyncStorage.getItem(STORAGE_KEYS.USER);
    const user = rawUser ? JSON.parse(rawUser) : null;
    const recipientUserId = user?._id ? String(user._id) : null;
    if (!recipientUserId) return;

    await fetch(`${API_URL}/api/message/ack-delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId, recipientUserId }),
    }).catch(() => {});
  } catch {
    // best-effort
  }
}

async function queueDeliveryAckFromFcm(data: Record<string, string> | undefined) {
  try {
    if (data?.type !== 'message') return;
    const messageId = (data?.messageId || '').toString().trim();
    if (!messageId) return;
    const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_DELIVERY_ACKS);
    const arr: string[] = raw ? (JSON.parse(raw) as any) : [];
    const next = Array.from(new Set([...(Array.isArray(arr) ? arr : []), messageId])).slice(-200);
    await AsyncStorage.setItem(STORAGE_KEYS.PENDING_DELIVERY_ACKS, JSON.stringify(next));

    // Best-effort HTTP ack so sender ticks can update even if socket isn't connected.
    // Don't block foreground UI.
    void ackDeliveredViaHttp(messageId);
  } catch {
    // best-effort
  }
}

/** Same payload shape as native IncomingCallActivity → NavigateToCallScreen (LiveKit). */
function emitNavigateToCallFromPushData(data: Record<string, string> | undefined) {
  if (!data) return;
  const callerId = (data.callerId || data.from || data.sender || '').toString().trim();
  if (!callerId) return;
  const callerName = (data.callerName || data.caller_name || 'Unknown').toString();
  const rawType = (data.callType || data.call_type || 'video').toString().toLowerCase();
  const callType = rawType === 'audio' || rawType === 'voice' ? 'audio' : 'video';
  const shouldAutoAnswer =
    data.action === 'answer' ||
    data.click_action === 'ANSWER_CALL' ||
    data.open === 'answer' ||
    data.shouldAutoAnswer === 'true' ||
    data.autoAnswer === 'true';
  DeviceEventEmitter.emit('NavigateToCallScreen', {
    callerId,
    callerName,
    callType,
    shouldAutoAnswer,
    isFromNotification: true,
  });
}

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
      const data = normalizeOpenedPushData(remoteMessage?.data as Record<string, string> | undefined);
      if (!data) return;
      if (data.type === 'incoming_call') {
        emitNavigateToCallFromPushData(data);
        return;
      }
      if (data.type === 'call_ended') return;
      if (data.type === 'message' || data.type === 'group_message' || data.type === 'group_added') {
        stashEarlyChatPush(data);
      }
      DeviceEventEmitter.emit('NavigateFromPush', data);
    });
  }

  /**
   * Cold start: user tapped a notification that launched the app.
   * Navigation is flushed from AppNavigator once the container is ready.
   */
  async getInitialPushData(): Promise<Record<string, string> | null> {
    try {
      const remoteMessage = await messaging().getInitialNotification();
      const data = normalizeOpenedPushData(remoteMessage?.data as Record<string, string> | undefined);
      if (!data) return null;
      if (data.type === 'incoming_call') {
        emitNavigateToCallFromPushData(data);
        return null;
      }
      return data;
    } catch (e) {
      console.warn('[FCM] getInitialPushData', e);
      return null;
    }
  }

  /** @deprecated use getInitialPushData + AppNavigator queue */
  async flushInitialNotification() {
    const data = await this.getInitialPushData();
    if (data) DeviceEventEmitter.emit('NavigateFromPush', data);
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

      if (data?.type === 'message' || data?.type === 'group_message') {
        // Do NOT pop an Alert in foreground — socket handles real-time UI.
        // Queue delivery ack and emit event so ChatScreen can refresh if needed.
        await queueDeliveryAckFromFcm(data);
        DeviceEventEmitter.emit('MessageFromFCM', { data, remoteMessage });
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
