/** True when URL points at a video file (R2, legacy Cloudinary, or direct file link). */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;
  const u = String(url);
  return /\.(mp4|webm|ogg|mov)(\?.*)?$/i.test(u) || u.includes('/video/upload/');
}

/** Chat list preview label for an attachment-only message. */
export function mediaPreviewLabel(img: string | null | undefined): string {
  const url = String(img || '').trim();
  if (!url) return '';
  return isVideoUrl(url) ? '🎥 Video' : '📷 Image';
}

function isMediaUrl(value: string): boolean {
  if (!value) return false;
  if (isVideoUrl(value)) return true;
  if (/\.(jpe?g|png|gif|webp|heic|bmp|avif)(\?.*)?$/i.test(value)) return true;
  return /^https?:\/\/\S+$/i.test(value);
}

/** Reply quote: show Video/Image, never the raw media URL. */
export function replyPreviewLabel(
  text?: string | null,
  img?: string | null,
): string {
  const attachment = String(img || '').trim();
  const raw = String(text || '').trim();
  const candidate = attachment || raw;
  if (candidate && (attachment || isMediaUrl(candidate))) {
    return mediaPreviewLabel(candidate) || raw;
  }
  return raw;
}

/** Media URL for a WhatsApp-style reply thumbnail. */
export function replyMediaUrl(
  text?: string | null,
  img?: string | null,
): string {
  const attachment = String(img || '').trim();
  const raw = String(text || '').trim();
  const candidate = attachment || raw;
  if (candidate && (attachment || isMediaUrl(candidate))) {
    return mediaDisplayUrl(candidate);
  }
  return '';
}

/** Display URL as stored by the backend (R2 public URL). */
export function mediaDisplayUrl(url: string): string {
  return String(url || '').trim();
}

/** Cloudinary video → still frame. Empty for R2 (client grabs a frame). */
export function videoPosterUrl(url: string): string {
  const u = String(url || '').trim();
  if (!u || !isVideoUrl(u)) return '';
  const marker = '/video/upload/';
  const idx = u.indexOf(marker);
  if (idx === -1) return '';
  const rest = u.slice(idx + marker.length).replace(/\.(mp4|webm|ogg|mov)(\?.*)?$/i, '.jpg$2');
  return `${u.slice(0, idx)}${marker}so_1,w_720,c_fill,q_auto,f_jpg/${rest}`;
}

/** Keep reply thumbs after reload: copy img from snapshot or the original message in this list. */
export function hydrateReplyThumbs<T extends Record<string, any>>(messages: T[]): T[] {
  const byId = new Map<string, T>();
  for (const m of messages) {
    if (m?._id) byId.set(String(m._id), m);
  }
  return messages.map((m) => {
    const r = m.replyTo;
    if (!r) return m;
    const preview = m.replyPreview;
    const quotedObj = r && typeof r === 'object' ? r : null;
    const quotedId = String(quotedObj?._id || r || '');
    const fromList = quotedId ? byId.get(quotedId) : undefined;
    const img = String(quotedObj?.img || preview?.img || fromList?.img || '').trim();
    const text = quotedObj?.text ?? preview?.text ?? fromList?.text ?? '';
    const sender =
      quotedObj?.sender ||
      fromList?.sender ||
      (preview?.senderName ? { name: preview.senderName } : undefined);
    if (!img && quotedObj?.img == null && !preview?.img && !fromList?.img) {
      return m;
    }
    return {
      ...m,
      replyTo: {
        ...(quotedObj || {}),
        _id: quotedId || quotedObj?._id,
        img: img || quotedObj?.img || '',
        text,
        sender,
      },
    };
  });
}
