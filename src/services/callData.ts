import { NativeModules } from 'react-native';

const { CallDataModule } = NativeModules;

interface CallData {
  callerId?: string;
  callerName?: string;
  callType?: string;
  shouldAutoAnswer?: boolean;
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

export const setCurrentUserId = async (userId: string): Promise<void> => {
  try {
    if (CallDataModule && CallDataModule.setCurrentUserId) {
      await CallDataModule.setCurrentUserId(userId);
    }
  } catch (error) {
    console.error('[CallData] Error storing user ID:', error);
  }
};
