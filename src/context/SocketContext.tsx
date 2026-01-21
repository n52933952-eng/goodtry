import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import socketService from '../services/socket';
import { useUser } from './UserContext';
import { usePost } from './PostContext';
import { SOCKET_EVENTS } from '../utils/constants';

interface SocketContextType {
  socket: typeof socketService;
  onlineUsers: any[];
  chessChallenge: any | null;
  clearChessChallenge: () => void;
  notificationCount: number;
  setNotificationCount: (count: number | ((prev: number) => number)) => void;
  selectedConversationId: string | null;
  setSelectedConversationId: (id: string | null) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const { addPost, updatePost, deletePost } = usePost();
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [chessChallenge, setChessChallenge] = useState<any | null>(null);
  const [notificationCount, setNotificationCount] = useState<number>(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);

  // Presence optimization:
  // - Prefer `presenceSnapshot` + `presenceUpdate` for a targeted list of users (followers/following)
  // - Keep legacy `getOnlineUser` as fallback for old server/client behavior
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;

    // CRITICAL: Remove all existing listeners first to prevent duplicates
    // This ensures we don't accumulate listeners if useEffect runs multiple times
    socketService.off('getOnlineUser');
    socketService.off(SOCKET_EVENTS.NEW_POST);
    socketService.off(SOCKET_EVENTS.POST_UPDATED);
    socketService.off(SOCKET_EVENTS.POST_DELETED);
    socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
    socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
    socketService.off(SOCKET_EVENTS.CHESS_MOVE);
    socketService.off('newNotification');

    // Set up listeners - will be queued if socket not ready yet
    console.log('🔧 Setting up socket listeners in SocketContext');

    // New: targeted presence snapshot (preferred)
    socketService.on('presenceSnapshot', (payload: any) => {
      const users = payload?.onlineUsers;
      if (!users || !Array.isArray(users)) return;

      setPresenceMap(() => {
        const next: Record<string, boolean> = {};
        users.forEach((u: any) => {
          const id = (typeof u === 'object' && u !== null)
            ? (u.userId?.toString?.() ?? u._id?.toString?.() ?? u.toString?.())
            : u?.toString?.();
          if (id) next[id] = true;
        });
        return next;
      });

      // Keep `onlineUsers` array populated so existing UI helpers keep working
      setOnlineUsers(users);
    });

    // New: targeted presence delta updates (preferred)
    socketService.on('presenceUpdate', (payload: any) => {
      const id = payload?.userId?.toString?.() ?? payload?.userId;
      const online = payload?.online === true;
      if (!id) return;

      setPresenceMap((prev) => ({ ...prev, [id]: online }));
      setOnlineUsers((prev) => {
        // Normalize to objects like { userId } so existing checks work
        const safePrev = Array.isArray(prev) ? prev : [];
        const filtered = safePrev.filter((x: any) => {
          const xId = (typeof x === 'object' && x !== null)
            ? (x.userId?.toString?.() ?? x._id?.toString?.() ?? x.toString?.())
            : x?.toString?.();
          return xId && xId !== id;
        });
        return online ? [{ userId: id }, ...filtered] : filtered;
      });
    });

    // Legacy: Listen for online users updates (global list)
    socketService.on('getOnlineUser', (users) => {
      console.log('👥 Online users event received!', users?.length || 0, 'users');
      setOnlineUsers(users || []);
    });

    // Listen for new posts
    socketService.on(SOCKET_EVENTS.NEW_POST, (post) => {
      console.log('📩 New post received:', post);
      addPost(post);
    });

    // Listen for post updates
    // Backend commonly emits: { postId, post } (web + system posts like Weather/Football)
    // Some codepaths may emit the post object directly. Support both shapes.
    socketService.on(SOCKET_EVENTS.POST_UPDATED, (payload: any) => {
      console.log('✏️ Post updated:', payload);

      const post = payload?.post ?? payload;
      const postId =
        post?._id?.toString?.() ??
        payload?.postId?.toString?.() ??
        (payload?.postId ? String(payload.postId) : null);

      if (!postId) return;
      updatePost(postId, post);
    });

    // Listen for post deletions
    socketService.on(SOCKET_EVENTS.POST_DELETED, (postId) => {
      console.log('🗑️ Post deleted:', postId);
      deletePost(postId);
    });

    // Listen for football updates
    socketService.on(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE, (data) => {
      console.log('⚽ Football match update:', data);
      // Handle football match updates
    });

    // Listen for chess challenges
    socketService.on(SOCKET_EVENTS.CHESS_CHALLENGE, (data) => {
      console.log('♟️ Chess challenge received:', data);
      // Store for global in-app notification UI (like web)
      setChessChallenge({
        ...data,
        isReceivingChallenge: true,
      });
    });

    // Listen for chess moves
    socketService.on(SOCKET_EVENTS.CHESS_MOVE, (data) => {
      console.log('♟️ Chess move received:', data);
      // Handle chess moves
    });

    // Listen for new notifications
    socketService.on('newNotification', (notification) => {
      console.log('🔔 New notification received:', notification);
      setNotificationCount(prev => prev + 1);
    });

    // Subscribe to targeted presence updates (followers + following)
    // Backwards-compatible: if server doesn't support it, nothing breaks (legacy getOnlineUser still works)
    try {
      const ids = Array.from(
        new Set([...(user.following || []), ...(user.followers || [])].map((x: any) => x?.toString?.() ?? String(x)))
      ).filter(Boolean);
      socketService.emit('presenceSubscribe', { userIds: ids });
    } catch (e) {
      // Best-effort
    }

    // Cleanup listeners on unmount
    return () => {
      socketService.off('getOnlineUser');
      socketService.off('presenceSnapshot');
      socketService.off('presenceUpdate');
      socketService.off(SOCKET_EVENTS.NEW_POST);
      socketService.off(SOCKET_EVENTS.POST_UPDATED);
      socketService.off(SOCKET_EVENTS.POST_DELETED);
      socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
      socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
      socketService.off(SOCKET_EVENTS.CHESS_MOVE);
      socketService.off('newNotification');
    };
  }, [user, addPost, updatePost, deletePost]);

  const clearChessChallenge = () => setChessChallenge(null);

  return (
    <SocketContext.Provider value={{ 
      socket: socketService, 
      onlineUsers, 
      chessChallenge, 
      clearChessChallenge,
      notificationCount,
      setNotificationCount,
      selectedConversationId,
      setSelectedConversationId,
    }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
};
