/**
 * Persist message/group push deep-links across cold start.
 * Native MainActivity writes ChatPushPrefs before RN listeners mount;
 * AppNavigator reads + clears once nav + auth are ready.
 */

import { NativeModules, Platform } from 'react-native';

const PREFS_NAME = 'ChatPushPrefs';

const { CallDataModule } = NativeModules;

function normalizePushMap(raw: Record<string, unknown> | null | undefined): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value == null) continue;
    if (key === 'hasPendingChatPush') continue;
    out[key] = String(value);
  }
  if (!out.type && out.conversationId) {
    out.type = out.isGroup === 'true' ? 'group_message' : 'message';
  }
  if (!out.type && !out.conversationId) return null;
  return out;
}

/** In-memory buffer if native event fires before AppNavigator listeners exist. */
let earlyChatPush: Record<string, string> | null = null;

export function stashEarlyChatPush(data: Record<string, unknown> | null | undefined) {
  const normalized = normalizePushMap(data as Record<string, unknown>);
  if (normalized) earlyChatPush = normalized;
}

export function takeEarlyChatPush(): Record<string, string> | null {
  const next = earlyChatPush;
  earlyChatPush = null;
  return next;
}

export async function getPendingChatPushFromNative(): Promise<Record<string, string> | null> {
  if (Platform.OS !== 'android' || !CallDataModule?.getSharedPreferences) return null;
  try {
    const raw = (await CallDataModule.getSharedPreferences(PREFS_NAME)) as Record<string, unknown> | null;
    if (!raw || Object.keys(raw).length === 0) return null;
    const flagged =
      raw.hasPendingChatPush === true ||
      raw.hasPendingChatPush === 'true' ||
      !!raw.conversationId ||
      raw.type === 'message' ||
      raw.type === 'group_message' ||
      raw.type === 'group_added';
    if (!flagged) return null;
    return normalizePushMap(raw);
  } catch (e) {
    console.warn('[chatPushPrefs] getPendingChatPushFromNative', e);
    return null;
  }
}

export async function clearPendingChatPushNative(): Promise<void> {
  if (Platform.OS !== 'android' || !CallDataModule?.clearSharedPreferences) return;
  try {
    await CallDataModule.clearSharedPreferences(PREFS_NAME);
  } catch (e) {
    console.warn('[chatPushPrefs] clearPendingChatPushNative', e);
  }
}

export async function consumePendingChatPush(): Promise<Record<string, string> | null> {
  const early = takeEarlyChatPush();
  if (early) {
    await clearPendingChatPushNative();
    return early;
  }
  const fromNative = await getPendingChatPushFromNative();
  if (fromNative) await clearPendingChatPushNative();
  return fromNative;
}
