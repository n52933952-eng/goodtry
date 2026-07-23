import { useEffect } from 'react';
import socketService from '../services/socket';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/** Join a post room while the card is mounted — receives live like/comment counts. */
export function usePostEngagementSubscription(postId: string | undefined | null) {
  useEffect(() => {
    if (!postId) return undefined;
    const pid = String(postId);
    if (!OBJECT_ID_RE.test(pid)) return undefined;

    const subscribe = () => {
      socketService.emitIfConnected('postSubscribeAdd', { postId: pid });
    };
    const unsubscribe = () => {
      socketService.emitIfConnected('postSubscribeRemove', { postId: pid });
    };

    subscribe();
    const removeConnect = socketService.addConnectListener(subscribe);
    const removeReady = socketService.addSocketReadyListener(() => {
      if (socketService.isSocketConnected()) subscribe();
    });

    return () => {
      removeConnect();
      removeReady();
      unsubscribe();
    };
  }, [postId]);
}

export function applyPostEngagement<T extends Record<string, any>>(
  post: T,
  data: Record<string, any> | null | undefined,
): T {
  if (!post || !data) return post;
  const postId = post._id?.toString?.();
  const incomingId = data.postId?.toString?.();
  if (!postId || !incomingId || postId !== incomingId) return post;

  const next = { ...post } as T;
  if (typeof data.likeCount === 'number') (next as any).likeCount = data.likeCount;
  if (data.likePreview !== undefined) (next as any).likePreview = data.likePreview;
  if (typeof data.replyCount === 'number') (next as any).replyCount = data.replyCount;
  if (data.replyPreview !== undefined) (next as any).replyPreview = data.replyPreview;
  return next;
}
