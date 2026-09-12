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

export function peekEarlyChatPush(): Record<string, string> | null {
  return earlyChatPush;
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
      !!raw.postId ||
      !!raw.type;
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

/**
 * Read the pending deep-link WITHOUT dropping it. Clearing on read used to lose the
 * tap when nav/auth wasn't ready yet (notification already dismissed → tap did nothing).
 * Call `clearPendingChatPush()` only once navigation actually happened.
 */
export async function peekPendingChatPush(): Promise<Record<string, string> | null> {
  const early = peekEarlyChatPush();
  if (early) return early;
  return await getPendingChatPushFromNative();
}

export async function clearPendingChatPush(): Promise<void> {
  earlyChatPush = null;
  await clearPendingChatPushNative();
}
