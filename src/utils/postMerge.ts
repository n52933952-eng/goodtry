import { contributorIdStr } from './postCarousel';

export type ProfileUser = {
  _id?: string;
  username?: string;
};

/** Merge socket/API post updates without losing populated user fields or stale media. */
export function mergePostUpdate<T extends Record<string, any>>(
  existing: T | null | undefined,
  incoming: Partial<T> | null | undefined,
): T {
  if (!existing) return (incoming || {}) as T;
  if (!incoming) return existing;

  const merged = { ...existing, ...incoming } as T;

  const exPb = existing.postedBy;
  const inPb = incoming.postedBy;
  if (exPb && typeof exPb === 'object' && (exPb.username || exPb.name)) {
    if (inPb && typeof inPb === 'object') merged.postedBy = { ...exPb, ...inPb };
    else if (typeof inPb === 'string') merged.postedBy = { ...exPb, _id: inPb };
    else merged.postedBy = exPb;
  }

  if (Array.isArray(incoming.contributors)) {
    const exMap = new Map<string, any>();
    for (const c of existing.contributors || []) {
      const id = contributorIdStr(c);
      if (id) exMap.set(id, typeof c === 'object' ? c : { _id: c });
    }
    merged.contributors = incoming.contributors.map((c) => {
      const id = contributorIdStr(c);
      const inc = typeof c === 'object' ? c : { _id: c };
      const old = exMap.get(id);
      if (old && !(inc.username || inc.name)) return { ...old, ...inc };
      return inc;
    });
  }

  if (Array.isArray(incoming.images)) merged.images = incoming.images;
  if (Array.isArray(incoming.collaboratorImages)) {
    merged.collaboratorImages = incoming.collaboratorImages;
  }
  if (incoming.img != null && incoming.img !== '') {
    merged.img = incoming.img;
  } else if (Array.isArray(incoming.images)) {
    merged.img = incoming.images.length > 0 ? incoming.images[0] : undefined;
  } else if (incoming.img === null || incoming.img === '') {
    merged.img = undefined;
  }

  if ('audio' in incoming) merged.audio = incoming.audio;
  if ('text' in incoming) merged.text = incoming.text;
  if ('editedAt' in incoming) merged.editedAt = incoming.editedAt;
  if ('isCollaborative' in incoming) merged.isCollaborative = incoming.isCollaborative;

  return merged;
}

/** Profile lists authored posts and collaborative posts the user contributes to.
 * Prefer IDs — username is only a fallback when author id is missing.
 */
export function postBelongsToProfile(post: any, profileUser: ProfileUser | null | undefined): boolean {
  if (!post || !profileUser) return false;
  const profileId = profileUser._id != null ? String(profileUser._id) : '';
  const profileUsername =
    typeof profileUser.username === 'string' ? profileUser.username.trim() : '';
  if (!profileId && !profileUsername) return false;

  const authorId = contributorIdStr(post.postedBy);
  const authorUsername =
    typeof post.postedBy === 'object' && post.postedBy?.username
      ? String(post.postedBy.username).trim()
      : '';

  if (profileId && authorId && authorId === profileId) return true;
  if (!authorId && profileUsername && authorUsername && authorUsername === profileUsername) {
    return true;
  }

  if (post.isCollaborative === true && Array.isArray(post.contributors)) {
    return post.contributors.some((c: any) => {
      const cid = contributorIdStr(c);
      if (profileId && cid && cid === profileId) return true;
      const uname = typeof c === 'object' && c?.username ? String(c.username).trim() : '';
      return !cid && !!profileUsername && !!uname && uname === profileUsername;
    });
  }
  return false;
}

export function sortPostsNewestFirst<T extends { updatedAt?: string; createdAt?: string }>(
  list: T[],
): T[] {
  return [...list].sort((a, b) => {
    const dateA = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const dateB = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return dateB - dateA;
  });
}

export function upsertProfilePost<T extends { _id?: string }>(
  list: T[],
  incoming: Partial<T>,
  postId: string,
): T[] {
  const idStr = postId?.toString?.();
  if (!idStr) return list;
  const idx = list.findIndex((p) => String(p._id) === idStr);
  if (idx === -1) return sortPostsNewestFirst([incoming as T, ...list]);
  const replaced = mergePostUpdate(list[idx], incoming);
  return sortPostsNewestFirst([replaced, ...list.filter((_, i) => i !== idx)]);
}
