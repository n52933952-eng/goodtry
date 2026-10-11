import { NativeModules } from 'react-native';
import { Video } from 'react-native-compressor';

/**
 * Turn a phone clip into a normal H.264 file the web player and the in-app player can open.
 * Pass the picker uri through. Resolving it to a gallery path makes Android throw setDataSource.
 */
export async function shrinkVideoForMessage(uri: string): Promise<string> {
  if (!uri) return uri;
  const out = await Video.compress(uri, {
    compressionMethod: 'manual',
    maxSize: 720,
    bitrate: 1500000,
    minimumFileSizeForCompress: 0,
  });
  if (!out) throw new Error('Could not prepare this video. Try a shorter clip.');
  if (out.startsWith('file://') || out.startsWith('content://')) return out;
  return `file://${out}`;
}

/** Drop the shrunk copy after upload. Only files inside app cache are removed. */
export async function removeTempVideo(uri: string): Promise<void> {
  if (!uri) return;
  const del = NativeModules.Compressor?.deleteTempFile;
  if (typeof del !== 'function') return;
  const raw = uri.startsWith('file://') ? uri.slice('file://'.length) : uri;
  const paths = [raw];
  if (raw.endsWith('-play.mp4')) paths.push(raw.replace(/-play\.mp4$/, '.mp4'));
  else if (raw.endsWith('.mp4')) paths.push(raw.replace(/\.mp4$/, '-play.mp4'));
  for (const path of paths) {
    try {
      await del(path);
    } catch {
      /* already gone */
    }
  }
}
