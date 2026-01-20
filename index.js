/**
 * @format
 */

import 'react-native-gesture-handler';
import '@react-native-firebase/app'; // Import Firebase app first to ensure initialization
import { AppRegistry, I18nManager } from 'react-native';
import messaging from '@react-native-firebase/messaging';
import App from './src/App';
import { name as appName } from './app.json';

// Force LTR layout even when device language is Arabic (keep icons/text positions consistent)
// NOTE: This requires a full reload/reinstall the first time it changes on device.
try {
  I18nManager.allowRTL(false);
  I18nManager.forceRTL(false);
  // Some RN versions support this; harmless if not present.
  if (typeof I18nManager.swapLeftAndRightInRTL === 'function') {
    I18nManager.swapLeftAndRightInRTL(false);
  }
} catch (e) {
  console.warn('⚠️ [i18n] Failed to force LTR:', e);
}

// Register background message handler
// Note: Native MyFirebaseMessagingService handles FCM when app is killed
// This JavaScript handler is a backup for when app is in background
try {
  messaging().setBackgroundMessageHandler(async (remoteMessage) => {
    console.log('🔥 [FCM] Background message received:', remoteMessage);
    console.log('🔥 [FCM] Message data:', remoteMessage.data);

    const data = remoteMessage.data;
    if (data?.type === 'incoming_call') {
      console.log('📞 [FCM] Incoming call in background/killed state');
      console.log('📞 [FCM] Caller:', data.callerName);
      console.log('📞 [FCM] Caller ID:', data.callerId);
      console.log('📞 [FCM] Call Type:', data.callType);
      console.log('✅ [FCM] Native MyFirebaseMessagingService will handle this (shows IncomingCallActivity)');
    } else if (data?.type === 'call_ended') {
      console.log('🔕 [FCM] Call ended notification in background');
      console.log('✅ [FCM] Native service will stop ringtone');
    } else {
      console.log('⚠️ [FCM] Not a call notification, type:', data?.type);
    }
  });
  console.log('✅ [FCM] Background message handler registered');
} catch (error) {
  console.error('❌ [FCM] Error setting up background message handler:', error);
  console.error('❌ [FCM] This might happen if Firebase is not initialized yet');
  console.error('❌ [FCM] Firebase should auto-initialize from google-services.json');
  console.error('❌ [FCM] Make sure app is rebuilt after adding google-services.json');
}

AppRegistry.registerComponent(appName, () => App);
