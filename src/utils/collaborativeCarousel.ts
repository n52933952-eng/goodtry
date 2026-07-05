export type CollaborativeCarouselSlide = {
  userId: string;
  img: string;
  name?: string;
  username?: string;
  profilePic?: string | null;
};

export function contributorIdStr(c: unknown): string {
  if (c == null) return '';
  if (typeof c === 'string' || typeof c === 'number') return String(c);
  if (typeof c === 'object' && c !== null && '_id' in c) {
    const id = (c as { _id?: unknown })._id;
    return id != null ? String(id) : '';
  }
  return '';
}

function isVideoUrl(url: string): boolean {
  const raw = String(url || '');
  return /\.(mp4|webm|ogg|mov)$/i.test(raw) || raw.includes('/video/upload/');
}

export function getCollaborativeCarouselSlides(post: any): CollaborativeCarouselSlide[] {
  if (!post?.isCollaborative) return [];

  const ownerId = contributorIdStr(post.postedBy);
  const postedByObj = typeof post.postedBy === 'object' ? post.postedBy : null;
  const byUser = new Map<string, string>();

  for (const row of post.collaboratorImages || []) {
    if (row?.userId && row?.img) {
      const img = String(row.img);
      if (!isVideoUrl(img)) byUser.set(String(row.userId), img);
    }
  }

  const slides: CollaborativeCarouselSlide[] = [];
  const ownerImg = byUser.get(ownerId) || (post.img && !isVideoUrl(String(post.img)) ? String(post.img) : '');
  if (ownerImg) {
    slides.push({
      userId: ownerId,
      img: ownerImg,
      name: postedByObj?.name,
      username: postedByObj?.username,
      profilePic: postedByObj?.profilePic,
    });
  }

  for (const c of post.contributors || []) {
    const cid = contributorIdStr(c);
    if (!cid || cid === ownerId) continue;
    const img = byUser.get(cid);
    if (!img) continue;
    const cObj = typeof c === 'object' ? c : null;
    slides.push({
      userId: cid,
      img,
      name: cObj?.name,
      username: cObj?.username,
      profilePic: cObj?.profilePic,
    });
  }

  return slides;
}

export function getMyCollaboratorImage(post: any, userId: string): string | null {
  if (!userId) return null;
  const uid = String(userId);
  for (const row of post?.collaboratorImages || []) {
    if (String(row.userId) === uid && row?.img) return String(row.img);
  }
  const ownerId = contributorIdStr(post?.postedBy);
  if (uid === ownerId && post?.img && !isVideoUrl(String(post.img))) {
    return String(post.img);
  }
  return null;
}
