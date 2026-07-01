import { DeviceEventEmitter } from 'react-native';

/** Broadcast to every mounted Post — hard-stop WebView video immediately (sync, no re-render wait). */
export const FEED_VIDEO_PAUSE_ALL = 'FEED_VIDEO_PAUSE_ALL';

export function pauseAllFeedVideos(): void {
  DeviceEventEmitter.emit(FEED_VIDEO_PAUSE_ALL);
}
