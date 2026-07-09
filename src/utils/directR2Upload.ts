import { Platform } from 'react-native';
import ImageResizer from '@bam.tech/react-native-image-resizer';
import { apiService } from '../services/api';
import { ENDPOINTS } from './constants';

export type DirectUploadFolder =
  | 'posts'
  | 'messages'
  | 'stories'
  | 'profile-pics';

export type LocalMediaInput = {
  uri: string;
  type?: string | null;
  fileName?: string | null;
  /** When true, skip image resize (already small / video / audio). */
  skipCompress?: boolean;
};

export type PresignResult = {
  uploadUrl: string;
  publicUrl: string;
  key: string;
  mimetype: string;
};

function guessMime(uri: string, type?: string | null, fileName?: string | null): string {
  if (type && String(type).includes('/')) return String(type);
  const name = `${fileName || ''} ${uri || ''}`.toLowerCase();
  if (/\.png(\?|$)/.test(name)) return 'image/png';
  if (/\.webp(\?|$)/.test(name)) return 'image/webp';
  if (/\.gif(\?|$)/.test(name)) return 'image/gif';
  if (/\.mp4(\?|$)/.test(name)) return 'video/mp4';
  if (/\.mov(\?|$)/.test(name)) return 'video/quicktime';
  if (/\.webm(\?|$)/.test(name)) return 'video/webm';
  if (/\.mp3(\?|$)/.test(name)) return 'audio/mpeg';
  if (/\.m4a(\?|$)/.test(name)) return 'audio/mp4';
  if (/\.aac(\?|$)/.test(name)) return 'audio/aac';
  if (/\.wav(\?|$)/.test(name)) return 'audio/wav';
  return 'image/jpeg';
}

function isImageMime(mime: string) {
  return String(mime || '').startsWith('image/');
}

function isGifMime(mime: string) {
  return String(mime || '').includes('gif');
}

/** Light on-device image compress before R2 PUT (videos/audio pass through). */
export async function compressLocalMedia(
  input: LocalMediaInput,
): Promise<{ uri: string; mime: string }> {
  const mime = guessMime(input.uri, input.type, input.fileName);
  if (input.skipCompress || !isImageMime(mime) || isGifMime(mime)) {
    return { uri: input.uri, mime };
  }

  try {
    const path = input.uri.replace('file://', '');
    const result = await ImageResizer.createResizedImage(
      Platform.OS === 'android' && !input.uri.startsWith('file://')
        ? input.uri
        : input.uri,
      1920,
      1920,
      'JPEG',
      80,
      0,
      undefined,
      false,
      { mode: 'contain', onlyScaleDown: true },
    );
    return { uri: result.uri, mime: 'image/jpeg' };
  } catch (e) {
    console.warn('[directUpload] compress failed, using original', e);
    return { uri: input.uri, mime };
  }
}

async function blobFromUri(uri: string, mime: string): Promise<Blob> {
  const res = await fetch(uri);
  const blob = await res.blob();
  if (blob.type && blob.type !== 'application/octet-stream') return blob;
  // RN sometimes returns empty type — wrap via Response if needed
  return blob.size ? blob : new Blob([blob], { type: mime });
}

async function putToR2(uploadUrl: string, uri: string, mime: string): Promise<void> {
  const body = await blobFromUri(uri, mime);
  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': mime,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`R2 upload failed (${res.status}): ${text || res.statusText}`);
  }
}

async function presignOne(
  folder: DirectUploadFolder,
  mimetype: string,
): Promise<PresignResult> {
  const data = await apiService.post(ENDPOINTS.MEDIA_PRESIGN, {
    folder,
    mimetype,
  });
  if (!data?.uploadUrl || !data?.publicUrl) {
    throw new Error('Failed to get upload URL');
  }
  return data as PresignResult;
}

async function presignMany(
  files: { folder: DirectUploadFolder; mimetype: string }[],
): Promise<PresignResult[]> {
  const data = await apiService.post(ENDPOINTS.MEDIA_PRESIGN, { files });
  const uploads = data?.uploads;
  if (!Array.isArray(uploads) || uploads.length !== files.length) {
    throw new Error('Failed to get upload URLs');
  }
  return uploads as PresignResult[];
}

/**
 * Compress (images) → presign → PUT direct to Cloudflare R2 → return public URL.
 * Render API never receives the file bytes.
 */
export async function uploadMediaToR2(
  input: LocalMediaInput,
  folder: DirectUploadFolder,
): Promise<string> {
  const { uri, mime } = await compressLocalMedia(input);
  const signed = await presignOne(folder, mime);
  await putToR2(signed.uploadUrl, uri, mime);
  return signed.publicUrl;
}

/** Parallel upload of many local files to the same folder. */
export async function uploadManyMediaToR2(
  inputs: LocalMediaInput[],
  folder: DirectUploadFolder,
): Promise<string[]> {
  if (!inputs.length) return [];
  const prepared = await Promise.all(inputs.map((i) => compressLocalMedia(i)));
  const signed = await presignMany(
    prepared.map((p) => ({ folder, mimetype: p.mime })),
  );
  await Promise.all(
    prepared.map((p, i) => putToR2(signed[i].uploadUrl, p.uri, p.mime)),
  );
  return signed.map((s) => s.publicUrl);
}
