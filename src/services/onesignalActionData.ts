/**
 * Helper functions to read/write OneSignal action button data from SharedPreferences
 * Similar to callData.ts but for OneSignal notification actions
 */

import { NativeModules, Platform } from 'react-native';

const { CallDataModule } = NativeModules;

export interface OneSignalActionData {
  action: string;
  notificationType?: string;
  postId?: string;
  userId?: string;
  notificationData?: string;
  actionTimestamp?: number;
}

/**
 * Get pending OneSignal action data from SharedPreferences
 * Returns null if no pending action
 */
export async function getPendingOneSignalAction(): Promise<OneSignalActionData | null> {
  if (Platform.OS !== 'android' || !CallDataModule) {
    return null;
  }

  try {
    const prefs = await CallDataModule.getSharedPreferences('OneSignalActionPrefs');
    const action = prefs?.action;
    const actionTimestamp = prefs?.actionTimestamp;

    // Check if action is recent (within last 10 seconds)
    if (action && actionTimestamp) {
      const now = Date.now();
      const age = now - actionTimestamp;
      if (age > 10000) {
        // Action is too old, ignore it
        return null;
      }
    }

    if (action) {
      return {
        action: prefs.action,
        notificationType: prefs.notificationType,
        postId: prefs.postId,
        userId: prefs.userId,
        notificationData: prefs.notificationData,
        actionTimestamp: prefs.actionTimestamp,
      };
    }

    return null;
  } catch (error) {
    console.error('❌ [OneSignalActionData] Error reading SharedPreferences:', error);
    return null;
  }
}

/**
 * Clear OneSignal action data from SharedPreferences
 */
export async function clearOneSignalAction(): Promise<void> {
  if (Platform.OS !== 'android' || !CallDataModule) {
    return;
  }

  try {
    await CallDataModule.clearSharedPreferences('OneSignalActionPrefs');
    console.log('✅ [OneSignalActionData] Cleared OneSignal action data from SharedPreferences');
  } catch (error) {
    console.error('❌ [OneSignalActionData] Error clearing SharedPreferences:', error);
  }
}
