/** System / news channel accounts that appear as feed cards (YouTube + channelAddedBy). */
export const CHANNEL_USERNAMES = [
  'Football',
  'AlJazeera',
  'NBCNews',
  'BeinSportsNews',
  'SkyNews',
  'Cartoonito',
  'NatGeoKids',
  'SciShowKids',
  'JJAnimalTime',
  'KidsArabic',
  'NatGeoAnimals',
  'MBCDrama',
  'Fox11',
  'VideoShelf',
] as const;

export function getYouTubeVideoId(url: string): string {
  if (!url) return '';
  const normalized = url.trim();
  const patterns = [
    /youtube\.com\/embed\/([^?&/]+)/i,
    /youtube\.com\/watch\?v=([^?&/]+)/i,
    /youtu\.be\/([^?&/]+)/i,
    /youtube\.com\/shorts\/([^?&/]+)/i,
    /youtube\.com\/live\/([^?&/]+)/i,
    /(?:ytimg\.com|img\.youtube\.com)\/vi\/([^?&/]+)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

export function isYouTubePost(post: { img?: string } | null | undefined): boolean {
  return !!getYouTubeVideoId(String(post?.img || ''));
}

/** Dailymotion / Vimeo embed saved on a normal post. YouTube stays on its own player. */
export function getExternalVideoEmbed(url?: string): { src: string; thumb: string } | null {
  const raw = String(url || '');
  const dm = raw.match(/dailymotion\.com\/(?:embed\/video|video)\/([a-zA-Z0-9]+)/i) || raw.match(/[?&]video=([a-zA-Z0-9]+)/i);
  if (dm?.[1] && /dailymotion\.com/i.test(raw)) {
    return {
      src: `https://geo.dailymotion.com/player.html?video=${dm[1]}`,
      thumb: `https://www.dailymotion.com/thumbnail/video/${dm[1]}`,
    };
  }
  const vm = raw.match(/player\.vimeo\.com\/video\/(\d+)/);
  if (vm) return { src: raw, thumb: `https://vumbnail.com/${vm[1]}.jpg` };
  return null;
}

const PAGE_LINK_MEDIA = /\.(mp4|webm|ogg|mov|m4v|jpg|jpeg|png|gif|webp|avif)(\?|$)/i

/** A normal website address. It opens in the browser. It is not played inside the post. */
export function isPlainPageLink(url?: string): boolean {
  const raw = String(url || '').trim()
  if (!/^https?:\/\//i.test(raw)) return false
  if (getYouTubeVideoId(raw)) return false
  if (getExternalVideoEmbed(raw)) return false
  if (PAGE_LINK_MEDIA.test(raw)) return false
  return true
}

export function pageLinkHost(url?: string): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}

export type PagePreviewKind = 'site' | 'shot' | 'icon';

/** Pictures to try before the letter card. The page shot is one try, not a loop. */
export function pagePreviewCandidates(url?: string, savedThumb?: string): { uri: string; kind: PagePreviewKind }[] {
  const list: { uri: string; kind: PagePreviewKind }[] = [];
  const thumb = String(savedThumb || '').trim();
  if (/^https?:\/\//i.test(thumb)) list.push({ uri: thumb, kind: 'site' });
  const raw = String(url || '').trim();
  const host = pageLinkHost(raw);
  if (/^https?:\/\//i.test(raw)) {
    list.push({
      uri: `https://s.wordpress.com/mshots/v1/${encodeURIComponent(raw)}?w=720`,
      kind: 'shot',
    });
  }
  if (host && host !== 'Link') {
    list.push({
      uri: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=256`,
      kind: 'icon',
    });
    list.push({
      uri: `https://icons.duckduckgo.com/ip3/${encodeURIComponent(host)}.ico`,
      kind: 'icon',
    });
  }
  return list;
}

export function isChannelPost(post: any): boolean {
  if (!post) return false;
  if (post.channelAddedBy) return true;
  const username = post.postedBy?.username;
  return !!username && (CHANNEL_USERNAMES as readonly string[]).includes(username);
}

/** News / YouTube channels: likes only at post level. Football keeps per-match comments. */
export function hideChannelPostComments(post: any): boolean {
  if (!isChannelPost(post)) return false;
  return post?.postedBy?.username !== 'Football';
}
