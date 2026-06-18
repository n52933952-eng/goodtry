/**
 * Deep links from FCM notification `data` payloads (likes, messages, chess, etc.).
 * Incoming calls: `type === incoming_call` is handled in fcmService → DeviceEventEmitter NavigateToCallScreen.
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
      const profileUsername = (raw.username || raw.followerUsername || '').trim();
      const userId = (raw.userId || '').trim();
      const profileQuery = profileUsername || userId;
      if (profileQuery) {
        nav.navigate('Profile', {
          screen: 'UserProfile',
          params: profileUsername
            ? { username: profileUsername }
            : { userId: profileQuery },
        });
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
      const conversationId = raw.conversationId;
      const senderId = raw.senderId || raw.userId || raw.fromUserId;
      if (conversationId) {
        nav.navigate('ChatScreen', {
          conversationId,
          ...(senderId
            ? {
                userId: senderId,
                otherUser: {
                  _id: senderId,
                  name: raw.senderName,
                  username: raw.senderUsername,
                  profilePic: raw.senderProfilePic,
                },
              }
            : {}),
        });
        return true;
      }
      if (senderId) {
        nav.navigate('ChatScreen', {
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

    if (type === 'group_message' || type === 'group_added') {
      const conversationId = raw.conversationId;
      if (conversationId) {
        nav.navigate('ChatScreen', {
          conversationId,
          isGroup: true,
          groupName: raw.groupName || 'Group',
          conversation: {
            _id: conversationId,
            isGroup: true,
            groupName: raw.groupName || 'Group',
            participants: [],
          },
        });
        return true;
      }
      nav.navigate('Messages');
      return true;
    }

    if (type === 'group_removed') {
      nav.navigate('Messages');
      return true;
    }

    if (type === 'missed_call') {
      return false;
    }

    /** Live alert — home feed only (stream may have ended by the time user opens the app). */
    if (type === 'live_started') {
      nav.navigate('MainTabs', { screen: 'Feed' });
      return true;
    }

    return false;
  } catch (e) {
    console.warn('[pushNavigation] navigateFromPushData', e);
    return false;
  }
}
