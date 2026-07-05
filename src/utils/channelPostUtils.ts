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

export function isChannelPost(post: any): boolean {
  if (!post) return false;
  if (isYouTubePost(post)) return true;
  if (post.channelAddedBy) return true;
  const username = post.postedBy?.username;
  return !!username && (CHANNEL_USERNAMES as readonly string[]).includes(username);
}

/** News / YouTube channels: likes only at post level. Football keeps per-match comments. */
export function hideChannelPostComments(post: any): boolean {
  if (!isChannelPost(post)) return false;
  return post?.postedBy?.username !== 'Football';
}
