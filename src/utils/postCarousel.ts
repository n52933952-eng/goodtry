export const MAX_POST_CAROUSEL_IMAGES = 4;

export type PostCarouselSlide = {
  key: string;
  userId?: string;
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

function getOwnerImageUrls(post: any): string[] {
  const fromArray = Array.isArray(post?.images)
    ? post.images.map(String).filter((u) => u && !isVideoUrl(u))
    : [];
  if (fromArray.length) return fromArray.slice(0, MAX_POST_CAROUSEL_IMAGES);
  const legacy = post?.img ? String(post.img) : '';
  if (legacy && !isVideoUrl(legacy)) return [legacy];
  return [];
}

/** Instagram-style slides: owner photos first, then collaborator photos. */
export function getPostCarouselSlides(post: any): PostCarouselSlide[] {
  const ownerId = contributorIdStr(post?.postedBy);
  const postedByObj = typeof post?.postedBy === 'object' ? post.postedBy : null;
  const slides: PostCarouselSlide[] = [];

  for (const img of getOwnerImageUrls(post)) {
    slides.push({
      key: `owner-${img}`,
      userId: ownerId,
      img,
      name: postedByObj?.name,
      username: postedByObj?.username,
      profilePic: postedByObj?.profilePic,
    });
  }

  if (post?.isCollaborative) {
    const ownerUrls = new Set(getOwnerImageUrls(post));
    const byUser = new Map<string, string>();
    for (const row of post.collaboratorImages || []) {
      if (row?.userId && row?.img && !isVideoUrl(String(row.img))) {
        byUser.set(String(row.userId), String(row.img));
      }
    }
    for (const c of post.contributors || []) {
      const cid = contributorIdStr(c);
      if (!cid || cid === ownerId) continue;
      const img = byUser.get(cid);
      if (!img || ownerUrls.has(img)) continue;
      const cObj = typeof c === 'object' ? c : null;
      slides.push({
        key: `contrib-${cid}-${img}`,
        userId: cid,
        img,
        name: cObj?.name,
        username: cObj?.username,
        profilePic: cObj?.profilePic,
      });
    }
  }

  return slides;
}

export function getPostCarouselAudio(post: any): string | null {
  const a = post?.audio;
  return a ? String(a) : null;
}

export function shouldShowPostCarousel(post: any): boolean {
  const slides = getPostCarouselSlides(post);
  if (slides.length > 1) return true;
  if (slides.length === 1 && Array.isArray(post?.images) && post.images.length > 0) return true;
  if (slides.length === 1 && getPostCarouselAudio(post)) return true;
  if (post?.isCollaborative && slides.length > 0) return true;
  return false;
}

export function getMyCollaboratorImage(post: any, userId: string): string | null {
  if (!userId) return null;
  const uid = String(userId);
  for (const row of post?.collaboratorImages || []) {
    if (String(row.userId) === uid && row?.img) return String(row.img);
  }
  const ownerId = contributorIdStr(post?.postedBy);
  if (uid === ownerId) {
    const ownerUrls = getOwnerImageUrls(post);
    if (ownerUrls.length) return ownerUrls[0];
  }
  return null;
}

/** @deprecated use getPostCarouselSlides */
export type CollaborativeCarouselSlide = PostCarouselSlide;
/** @deprecated use getPostCarouselSlides */
export const getCollaborativeCarouselSlides = getPostCarouselSlides;
