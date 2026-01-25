import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Vibration } from 'react-native';
import socketService from '../services/socket';
import { useUser } from './UserContext';
import { usePost } from './PostContext';
import { SOCKET_EVENTS, API_URL } from '../utils/constants';
import Sound from 'react-native-sound';

const NOTIFICATION_COUNT_KEY = '@notification_count';

interface SocketContextType {
  socket: typeof socketService;
  onlineUsers: any[];
  chessChallenges: any[];
  cardChallenges: any[];
  clearChessChallenge: (challengeFrom?: string) => void;
  clearCardChallenge: (challengeFrom?: string) => void;
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
  const [cardChallenges, setCardChallenges] = useState<any[]>([]);
  const [notificationCount, setNotificationCount] = useState<number>(0);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [isNotificationCountLoaded, setIsNotificationCountLoaded] = useState(false);
  
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

  // Load notification count from storage on mount
  useEffect(() => {
    const loadNotificationCount = async () => {
      try {
        const savedCount = await AsyncStorage.getItem(NOTIFICATION_COUNT_KEY);
        if (savedCount !== null) {
          const count = parseInt(savedCount, 10);
          if (!isNaN(count)) {
            console.log('📱 [SocketContext] Loaded notification count from storage:', count);
            setNotificationCount(count);
          }
        }
      } catch (error) {
        console.error('❌ [SocketContext] Error loading notification count:', error);
      } finally {
        setIsNotificationCountLoaded(true);
      }
    };
    loadNotificationCount();
  }, []);

  // Fetch actual notification count from server when user is available
  useEffect(() => {
    if (!user?._id || !isNotificationCountLoaded) return;

    const fetchNotificationCount = async () => {
      try {
        const response = await fetch(`${API_URL}/api/notification`, {
          credentials: 'include',
        });
        const data = await response.json();
        
        if (response.ok && data.unreadCount !== undefined) {
          const serverCount = data.unreadCount || 0;
          console.log('📱 [SocketContext] Fetched notification count from server:', serverCount);
          setNotificationCount(serverCount);
          // Save to storage
          await AsyncStorage.setItem(NOTIFICATION_COUNT_KEY, String(serverCount));
        }
      } catch (error) {
        console.error('❌ [SocketContext] Error fetching notification count:', error);
      }
    };

    fetchNotificationCount();
  }, [user?._id, isNotificationCountLoaded]);

  // Persist notification count whenever it changes
  useEffect(() => {
    if (!isNotificationCountLoaded) return;
    
    const saveCount = async () => {
      try {
        await AsyncStorage.setItem(NOTIFICATION_COUNT_KEY, String(notificationCount));
        console.log('💾 [SocketContext] Saved notification count to storage:', notificationCount);
      } catch (error) {
        console.error('❌ [SocketContext] Error saving notification count:', error);
      }
    };
    
    saveCount();
  }, [notificationCount, isNotificationCountLoaded]);

  // Presence optimization:
  // - Prefer `presenceSnapshot` + `presenceUpdate` for a targeted list of users (followers/following)
  // - Keep legacy `getOnlineUser` as fallback for old server/client behavior
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});

  // Clear notification count when user logs out
  useEffect(() => {
    if (!user) {
      // User logged out - clear notification count
      setNotificationCount(0);
      AsyncStorage.removeItem(NOTIFICATION_COUNT_KEY).catch(() => {});
      setIsNotificationCountLoaded(false);
      return;
    }

    // CRITICAL: Remove all existing listeners first to prevent duplicates
    // This ensures we don't accumulate listeners if useEffect runs multiple times
    // NOTE: Do NOT remove 'newMessage' here - ChatScreen and MessagesScreen handle their own listeners
    socketService.off('getOnlineUser');
    socketService.off(SOCKET_EVENTS.NEW_POST);
    socketService.off(SOCKET_EVENTS.POST_UPDATED);
    socketService.off(SOCKET_EVENTS.POST_DELETED);
    socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
    socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
    socketService.off(SOCKET_EVENTS.CHESS_MOVE);
    socketService.off(SOCKET_EVENTS.CARD_CHALLENGE);
    socketService.off(SOCKET_EVENTS.CARD_MOVE);
    socketService.off('newNotification');
    // socketService.off('newMessage'); // <-- REMOVED: Let screens manage their own listeners

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
      
      // Check if it's a chess game post - these should always be added (backend only emits to followers)
      const isChessPost = !!post?.chessGameData;
      
      if (isChessPost) {
        // Chess posts: Backend already filters to only send to followers, so always add
        console.log('✅ [SocketContext] Adding chess game post to feed:', post._id);
        addPost(post);
        return;
      }
      
      // For regular posts, check if user follows the author
      if (post?.postedBy?._id || post?.postedBy) {
        const authorId = post.postedBy._id?.toString?.() || post.postedBy.toString?.() || post.postedBy;
        const userFollowing = user?.following || [];
        const isFollowing = userFollowing.some((f: any) => {
          const followId = f?._id?.toString?.() || f?.toString?.() || f;
          return followId === authorId;
        });
        
        // Add post if following the author OR if it's a system post (Weather, Football, etc.)
        const isSystemPost = post.postedBy?.username === 'Weather' || 
                            post.postedBy?.username === 'Football' ||
                            post.postedBy?.username === 'AlJazeera';
        
        if (isFollowing || isSystemPost) {
          console.log('✅ [SocketContext] Adding post to feed:', post._id);
          addPost(post);
        } else {
          console.log('⚠️ [SocketContext] Ignoring post from user not followed:', authorId);
        }
      } else {
        // If no author info, add it anyway (shouldn't happen, but be safe)
        console.log('⚠️ [SocketContext] Post has no author info, adding anyway:', post._id);
        addPost(post);
      }
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
    socketService.on(SOCKET_EVENTS.POST_DELETED, (payload) => {
      // Backend sends: { postId: post._id } or just postId string
      const postId = payload?.postId?.toString?.() ?? payload?.toString?.() ?? payload;
      console.log('🗑️ [SocketContext] Post deleted event received:', { payload, postId });
      if (postId) {
        console.log('✅ [SocketContext] Removing post from feed:', postId);
        deletePost(postId);
      } else {
        console.warn('⚠️ [SocketContext] Post deletion event received but postId is missing:', payload);
      }
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
      // Play chess challenge sound and vibrate
      playNotificationSound('chessChallenge');
      Vibration.vibrate(400); // Vibrate for 400ms
    });

    // Listen for chess moves
    socketService.on(SOCKET_EVENTS.CHESS_MOVE, (data) => {
      console.log('♟️ Chess move received:', data);
      // Handle chess moves
    });

    // Listen for card game challenges
    socketService.on(SOCKET_EVENTS.CARD_CHALLENGE, (data) => {
      console.log('🃏 Card challenge received:', data);
      // Store for global in-app notification UI (like web)
      // Prevent duplicates
      setCardChallenges(prev => {
        if (prev.some(c => c.from === data.from)) {
          return prev; // Already have this challenge
        }
        return [...prev, {
          ...data,
          timestamp: Date.now(),
        }];
      });
      // Play notification sound and vibrate
      playNotificationSound('notification');
      Vibration.vibrate(400); // Vibrate for 400ms
    });

    // Listen for card game moves
    socketService.on(SOCKET_EVENTS.CARD_MOVE, (data) => {
      console.log('🃏 Card move received:', data);
      // Handle card moves
    });

    // Listen for new notifications
    socketService.on('newNotification', (notification) => {
      console.log('🔔 New notification received:', notification);
      // Only increment if notification is not already read
      // Backend should send read status, but be safe and increment only if not explicitly read
      const isRead = notification.read === true;
      if (!isRead) {
        setNotificationCount(prev => {
          // Prevent count from going negative
          const newCount = prev + 1;
          console.log('🔔 [SocketContext] Incrementing notification count:', prev, '->', newCount);
          return newCount;
        });
        // Vibrate phone when receiving unread notification
        Vibration.vibrate(400); // Vibrate for 400ms
      } else {
        console.log('🔔 [SocketContext] Notification already read, skipping count increment');
      }
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
      
      // Play sound and vibrate only for unread messages from other users AND not from currently open conversation
      if (shouldPlay) {
        playNotificationSound('message');
        Vibration.vibrate(400); // Vibrate for 400ms
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
      // socketService.off('newMessage'); // <-- Don't remove - screens manage their own
    };
  }, [user, addPost, updatePost, deletePost, selectedConversationId, playNotificationSound]);

  const clearChessChallenge = (challengeFrom?: string) => {
    if (challengeFrom) {
      setChessChallenges(prev => prev.filter(c => c.from !== challengeFrom));
    } else {
      setChessChallenges([]);
    }
  };

  const clearCardChallenge = (challengeFrom?: string) => {
    if (challengeFrom) {
      setCardChallenges(prev => prev.filter(c => c.from !== challengeFrom));
    } else {
      setCardChallenges([]);
    }
  };

  return (
    <SocketContext.Provider value={{ 
      socket: socketService, 
      onlineUsers, 
      chessChallenges,
      cardChallenges,
      clearChessChallenge,
      clearCardChallenge,
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
