import { DeviceEventEmitter } from 'react-native';

/** Broadcast to every mounted Post — hard-stop WebView video immediately (sync, no re-render wait). */
export const FEED_VIDEO_PAUSE_ALL = 'FEED_VIDEO_PAUSE_ALL';

/** Visible post ids in feed/profile lists — carousel audio listens without forcing list re-renders. */
export const FEED_VISIBLE_POSTS = 'FEED_VISIBLE_POSTS';

export function pauseAllFeedVideos(): void {
  DeviceEventEmitter.emit(FEED_VIDEO_PAUSE_ALL);
}

export function emitFeedVisiblePostIds(ids: string[]): void {
  DeviceEventEmitter.emit(FEED_VISIBLE_POSTS, ids);
}
