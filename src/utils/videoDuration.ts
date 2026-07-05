import { Asset } from 'react-native-image-picker';
import Sound from 'react-native-sound';

/** Max length for post / edit-post videos (matches server limit). */
export const MAX_POST_VIDEO_DURATION_SEC = 600;

/** Max length for carousel background music. */
export const MAX_POST_AUDIO_DURATION_SEC = 4 * 60;

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

/** Load audio locally and read duration (seconds), or null if unavailable. */
export function getAudioDurationSeconds(uri: string): Promise<number | null> {
  return new Promise((resolve) => {
    Sound.setCategory('Playback');
    // Do NOT call sound.release() here — react-native-sound can NPE on Android
    // when releasing a file:// / content URI used only for a duration probe.
    new Sound(uri, '', (error, props) => {
      if (error != null) {
        resolve(null);
        return;
      }
      const fromProps =
        typeof props?.duration === 'number' && props.duration > 0 ? props.duration : null;
      resolve(fromProps);
    });
  });
}

export function isAudioWithinMaxDuration(uri: string, maxSec: number): Promise<boolean> {
  return getAudioDurationSeconds(uri).then((sec) => {
    if (sec === null) return true;
    return sec <= maxSec + 0.5;
  });
}
