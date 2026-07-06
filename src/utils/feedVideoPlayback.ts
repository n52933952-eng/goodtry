import { DeviceEventEmitter } from 'react-native';

/** Broadcast to every mounted Post — hard-stop WebView video immediately (sync, no re-render wait). */
export const FEED_VIDEO_PAUSE_ALL = 'FEED_VIDEO_PAUSE_ALL';

/** Visible post ids in feed/profile lists — carousel audio listens without forcing list re-renders. */
export const FEED_VISIBLE_POSTS = 'FEED_VISIBLE_POSTS';

/** Global feed sound — Instagram-style: unmute once → next videos/MP3 play with sound too. */
export const FEED_MEDIA_SOUND_PREF = 'FEED_MEDIA_SOUND_PREF';

/** Ask feed/profile to focus autoplay on a post (e.g. MP3 added while already visible). */
export const FEED_REQUEST_MEDIA_AUTOPLAY = 'FEED_REQUEST_MEDIA_AUTOPLAY';

let feedMediaSoundUnmuted = false;

export function isFeedMediaSoundUnmuted(): boolean {
  return feedMediaSoundUnmuted;
}

export function isFeedMediaMuted(): boolean {
  return !feedMediaSoundUnmuted;
}

export function setFeedMediaSoundUnmuted(unmuted: boolean): void {
  feedMediaSoundUnmuted = !!unmuted;
  DeviceEventEmitter.emit(FEED_MEDIA_SOUND_PREF, { unmuted: feedMediaSoundUnmuted });
}

export function pauseAllFeedVideos(): void {
  DeviceEventEmitter.emit(FEED_VIDEO_PAUSE_ALL);
}

export function emitFeedVisiblePostIds(ids: string[]): void {
  DeviceEventEmitter.emit(FEED_VISIBLE_POSTS, ids);
}

/** Promote a post to the active feed media slot without waiting for scroll / reload. */
export function requestFeedMediaAutoplay(postId: string): void {
  const id = postId != null ? String(postId).trim() : '';
  if (!id) return;
  DeviceEventEmitter.emit(FEED_REQUEST_MEDIA_AUTOPLAY, { postId: id });
}

/** Feed/profile: native MP4 or carousel background MP3 — eligible for focused autoplay. */
export function isFeedAutoPlayMediaPost(post: any): boolean {
  if (!post) return false;
  const img = String(post.img || '');
  const isVideo =
    !!img && (/\.(mp4|webm|ogg|mov)$/i.test(img) || img.includes('/video/upload/'));
  const isYouTube = /youtube\.com|youtu\.be|ytimg\.com|img\.youtube\.com/i.test(img);
  if (isVideo && !isYouTube) return true;
  const audio = post.audio ? String(post.audio).trim() : '';
  return !!audio;
}
