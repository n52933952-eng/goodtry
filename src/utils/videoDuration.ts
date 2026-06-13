import { Asset } from 'react-native-image-picker';

/** Max length for post / edit-post videos (matches server limit). */
export const MAX_POST_VIDEO_DURATION_SEC = 600;

export function isVideoAsset(asset: Asset): boolean {
  const mime = asset.type || '';
  const uri = asset.uri || '';
  return mime.startsWith('video/') || /\.(mp4|mov|m4v|webm|mkv)$/i.test(uri);
}

/** Returns duration in seconds, or null when the picker did not report it. */
export function getVideoDurationSeconds(asset: Asset): number | null {
  const dur = asset.duration;
  if (typeof dur !== 'number' || !Number.isFinite(dur) || dur <= 0) {
    return null;
  }
  // iOS: seconds; Android image-picker often returns milliseconds.
  return dur > 1000 ? dur / 1000 : dur;
}

export function isVideoWithinMaxDuration(asset: Asset, maxSec: number): boolean {
  const sec = getVideoDurationSeconds(asset);
  if (sec === null) return true;
  return sec <= maxSec + 0.5;
}
