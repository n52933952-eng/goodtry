/**
 * Deep links from FCM notification `data` payloads (likes, messages, chess, etc.).
 * Incoming calls: `type === incoming_call` is handled in fcmService → DeviceEventEmitter NavigateToCallScreen.
 */

/**
 * Route names we can confirm afterwards via `getCurrentRoute()`. A cold start can drop a
 * `navigate()` that happens before the target navigator registered its screens, and
 * react-navigation only logs a warning — so the caller verifies instead of assuming.
 */
export const VERIFIABLE_PUSH_ROUTES = ['ChatScreen', 'PostDetail', 'ChessGame', 'UserProfile'];

/** @returns the route name we navigated to, or null when the payload isn't a deep link. */
export function navigateFromPushData(
  navigationRef: { current: any } | null,
  raw: Record<string, string> | undefined | null
): string | null {
  const nav = navigationRef?.current;
  if (!nav || !raw) return null;

  let type = raw.type ? String(raw.type) : '';
  if (!type && raw.conversationId) {
    type = raw.isGroup === 'true' ? 'group_message' : 'message';
  }
  if (!type) return null;

  if (type === 'incoming_call' || type === 'call_ended' || type === 'call_canceled' || type === 'call_cancelled') {
    return null;
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
        return 'UserProfile';
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
        return 'PostDetail';
      }
    }

    if (type === 'chess_challenge' || type === 'chess_move') {
      const roomId = raw.gameId || raw.roomId;
      if (roomId) {
        nav.navigate('ChessGame', { roomId: String(roomId) });
        return 'ChessGame';
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
        return 'ChatScreen';
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
        return 'ChatScreen';
      }
      // Incomplete payload (common on cold start from FCM) — keep pending so
      // ChatPushPrefs can supply conversationId on the next retry.
      return null;
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
        return 'ChatScreen';
      }
      return null;
    }

    if (type === 'group_removed') {
      nav.navigate('Messages');
      return 'Messages';
    }

    if (type === 'missed_call') {
      return null;
    }

    /** Live alert — home feed only (stream may have ended by the time user opens the app). */
    if (type === 'live_started') {
      nav.navigate('MainTabs', { screen: 'Feed' });
      return 'Feed';
    }

    return null;
  } catch (e) {
    console.warn('[pushNavigation] navigateFromPushData', e);
    return null;
  }
}
