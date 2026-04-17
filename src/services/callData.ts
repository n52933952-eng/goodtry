import { NativeModules } from 'react-native';

const { CallDataModule } = NativeModules;

interface CallData {
  callerId?: string;
  callerName?: string;
  callType?: string;
  shouldAutoAnswer?: boolean;
  shouldDecline?: boolean;
  hasPendingCall?: boolean;
  shouldCancelCall?: boolean;
  hasPendingCancel?: boolean;
  callerIdToCancel?: string;
}

export const getPendingCallData = async (): Promise<CallData | null> => {
  try {
    if (!CallDataModule) {
      console.warn('[CallData] CallDataModule not available');
      return null;
    }
    const data = await CallDataModule.getPendingCallData();
    return data as CallData | null;
  } catch (error) {
    console.error('[CallData] Error reading pending call data:', error);
    return null;
  }
};

export const clearCallData = async (): Promise<void> => {
  try {
    if (CallDataModule) {
      await CallDataModule.clearCallData();
    }
  } catch (error) {
    console.error('[CallData] Error clearing call data:', error);
  }
};

/** Android: prefs + tray notification + ringtone + IncomingCallActivity — call when the call session fully ends. */
export const onCallSessionEndedNative = async (): Promise<void> => {
  try {
    if (CallDataModule?.onCallSessionEnded) {
      await CallDataModule.onCallSessionEnded();
    }
  } catch (error) {
    console.error('[CallData] onCallSessionEnded:', error);
  }
};

/** Android: remove stale decline/cancel prefs so the next incoming call is not blocked. */
export const clearCallCancelFlagsNative = async (): Promise<void> => {
  try {
    if (CallDataModule?.clearCallCancelFlags) {
      await CallDataModule.clearCallCancelFlags();
    }
  } catch (error) {
    console.error('[CallData] clearCallCancelFlags:', error);
  }
};

export const setCurrentUserId = async (userId: string): Promise<void> => {
  try {
    if (CallDataModule && CallDataModule.setCurrentUserId) {
      await CallDataModule.setCurrentUserId(userId);
    }
  } catch (error) {
    console.error('[CallData] Error storing user ID:', error);
  }
};
