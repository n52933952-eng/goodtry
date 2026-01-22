import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from 'react';
import socketService from '../services/socket';
import { useUser } from './UserContext';
import { usePost } from './PostContext';
import { SOCKET_EVENTS } from '../utils/constants';
import Sound from 'react-native-sound';

interface SocketContextType {
  socket: typeof socketService;
  onlineUsers: any[];
  chessChallenges: any[];
  clearChessChallenge: (challengeFrom?: string) => void;
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
  const [chessChallenges, setChessChallenges] = useState<any[]>([]);
  const [notificationCount, setNotificationCount] = useState<number>(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  
  // Notification sounds
  const notificationSounds = useRef<{
    message?: Sound;
    chessChallenge?: Sound;
    notification?: Sound;
  }>({});

  // Initialize notification sounds
  useEffect(() => {
    // Enable playback in silence mode (iOS)
    Sound.setCategory('Playback', true);
    
    // Load notification sound files
    notificationSounds.current.message = new Sound('message.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [SocketContext] Failed to load message sound:', error);
        try {
          notificationSounds.current.message = new Sound(require('../assets/sounds/message.mp3'), (error2) => {
            if (error2) console.error('❌ [SocketContext] Failed to load message sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [SocketContext] Could not load message sound:', e);
        }
      }
    });
    
    notificationSounds.current.chessChallenge = new Sound('chess_challenge.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [SocketContext] Failed to load chess challenge sound:', error);
        try {
          notificationSounds.current.chessChallenge = new Sound(require('../assets/sounds/chess_challenge.mp3'), (error2) => {
            if (error2) console.error('❌ [SocketContext] Failed to load chess challenge sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [SocketContext] Could not load chess challenge sound:', e);
        }
      }
    });
    
    notificationSounds.current.notification = new Sound('notification.mp3', Sound.MAIN_BUNDLE, (error) => {
      if (error) {
        console.error('❌ [SocketContext] Failed to load notification sound:', error);
        try {
          notificationSounds.current.notification = new Sound(require('../assets/sounds/notification.mp3'), (error2) => {
            if (error2) console.error('❌ [SocketContext] Failed to load notification sound (fallback):', error2);
          });
        } catch (e) {
          console.error('❌ [SocketContext] Could not load notification sound:', e);
        }
      }
    });
    
    return () => {
      // Cleanup sounds on unmount
      Object.values(notificationSounds.current).forEach(sound => {
        if (sound) {
          sound.release();
        }
      });
    };
  }, []);

  const playNotificationSound = useCallback((type: 'message' | 'chessChallenge' | 'notification') => {
    const sound = notificationSounds.current[type];
    if (sound) {
      sound.stop(() => {
        sound.play((success) => {
          if (!success) {
            console.warn(`⚠️ [SocketContext] Failed to play ${type} sound`);
          } else {
            console.log(`🔊 [SocketContext] Played ${type} sound`);
          }
        });
      });
    }
  }, []);

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
    socketService.off('newMessage');

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
      // Prevent duplicates
      setChessChallenges(prev => {
        if (prev.some(c => c.from === data.from)) {
          return prev; // Already have this challenge
        }
        return [...prev, {
          ...data,
          timestamp: Date.now(),
        }];
      });
      // Play chess challenge sound
      playNotificationSound('chessChallenge');
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
      // Play notification sound for likes, comments, follows, mentions, etc.
      playNotificationSound('notification');
    });

    // Listen for new messages globally - play sound for unread messages
    socketService.on('newMessage', (messageData: any) => {
      if (!messageData || !messageData.sender || !user?._id) return;
      
      // Check if message is from another user (not current user)
      let messageSenderId = '';
      if (messageData.sender?._id) {
        messageSenderId = typeof messageData.sender._id === 'string' ? messageData.sender._id : messageData.sender._id.toString();
      } else if (messageData.sender) {
        messageSenderId = typeof messageData.sender === 'string' ? messageData.sender : String(messageData.sender);
      }
      
      let currentUserId = '';
      if (user?._id) {
        currentUserId = typeof user._id === 'string' ? user._id : user._id.toString();
      }
      
      const isFromCurrentUser = messageSenderId !== '' && currentUserId !== '' && messageSenderId === currentUserId;
      
      // Check if message is from the currently open conversation
      const conversationId = messageData.conversationId?.toString();
      const isFromOpenConversation = selectedConversationId && 
                                      conversationId && 
                                      selectedConversationId.toString() === conversationId.toString();
      
      const shouldPlay = !isFromCurrentUser && !isFromOpenConversation;
      
      console.log('🔔 [SocketContext] Message notification check:', {
        sender: messageSenderId,
        openConversation: selectedConversationId || 'none',
        isFromMe: isFromCurrentUser,
        isFromOpenChat: isFromOpenConversation,
        willPlaySound: shouldPlay
      });
      
      // Play sound only for unread messages from other users AND not from currently open conversation
      if (shouldPlay) {
        playNotificationSound('message');
      }
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
      socketService.off('newMessage');
    };
  }, [user, addPost, updatePost, deletePost, selectedConversationId, playNotificationSound]);

  const clearChessChallenge = (challengeFrom?: string) => {
    if (challengeFrom) {
      setChessChallenges(prev => prev.filter(c => c.from !== challengeFrom));
    } else {
      setChessChallenges([]);
    }
  };

  return (
    <SocketContext.Provider value={{ 
      socket: socketService, 
      onlineUsers, 
      chessChallenges, 
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
