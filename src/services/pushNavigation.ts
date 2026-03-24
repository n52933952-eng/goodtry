/**
 * Deep links from FCM notification `data` payloads (likes, messages, chess, etc.).
 * Call / incoming-call flows stay in native + WebRTC; do not route those here.
 */

export function navigateFromPushData(
  navigationRef: { current: any } | null,
  raw: Record<string, string> | undefined | null
): boolean {
  const nav = navigationRef?.current;
  if (!nav || !raw?.type) return false;

  const type = String(raw.type);
  if (type === 'incoming_call' || type === 'call_ended' || type === 'call_canceled' || type === 'call_cancelled') {
    return false;
  }

  try {
    if (type === 'follow') {
      const userId = raw.userId;
      if (userId) {
        nav.navigate('Profile', { screen: 'UserProfile', params: { userId } });
        return true;
      }
    }

    if (
      type === 'like' ||
      type === 'comment' ||
      type === 'mention' ||
      type === 'collaboration' ||
      type === 'post_edit' ||
      type === 'contributor'
    ) {
      const postId = raw.postId;
      if (postId) {
        nav.navigate('Feed', {
          screen: 'PostDetail',
          params: { postId: String(postId) },
        });
        return true;
      }
    }

    if (type === 'chess_challenge' || type === 'chess_move') {
      const roomId = raw.gameId || raw.roomId;
      if (roomId) {
        nav.navigate('ChessGame', { roomId: String(roomId) });
        return true;
      }
    }

    if (type === 'message') {
      const senderId = raw.senderId || raw.userId || raw.fromUserId;
      if (senderId) {
        nav.navigate('ChatScreen', {
          conversationId: raw.conversationId,
          userId: senderId,
          otherUser: {
            _id: senderId,
            name: raw.senderName,
            username: raw.senderUsername,
            profilePic: raw.senderProfilePic,
          },
        });
        return true;
      }
      nav.navigate('Messages');
      return true;
    }

    if (type === 'missed_call') {
      return false;
    }

    return false;
  } catch (e) {
    console.warn('[pushNavigation] navigateFromPushData', e);
    return false;
  }
}
