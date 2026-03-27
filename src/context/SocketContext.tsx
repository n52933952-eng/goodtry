import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, Vibration } from 'react-native';
import socketService from '../services/socket';
import { useUser } from './UserContext';
import { usePost } from './PostContext';
import { SOCKET_EVENTS, API_URL, STORAGE_KEYS } from '../utils/constants';
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
  selectedConversationPartnerId: string | null;
  setSelectedConversationPartnerId: (userId: string | null) => void;
  setPresenceWatchUserIds: (userIds: string[]) => void;
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
  const selectedConversationIdRef = useRef<string | null>(null);
  const [selectedConversationPartnerId, setSelectedConversationPartnerId] = useState<string | null>(null);
  const selectedConversationPartnerIdRef = useRef<string | null>(null);
  const [presenceWatchUserIds, setPresenceWatchUserIdsState] = useState<string[]>([]);
  const presenceWatchUserIdsRef = useRef<string[]>([]);
  const presenceSubscribeRef = useRef<(() => void) | null>(null);
  /** Stable socket listener so we only remove our `newMessage` handler, not ChatScreen’s. */
  const newMessageHandlerBodyRef = useRef<(data: any) => void>(() => {});
  const onNewMessageForSocket = useCallback((data: any) => {
    newMessageHandlerBodyRef.current?.(data);
  }, []);
  const [isNotificationCountLoaded, setIsNotificationCountLoaded] = useState(false);
  const setPresenceWatchUserIds = useCallback((userIds: string[]) => {
    const normalized = Array.from(
      new Set(
        (Array.isArray(userIds) ? userIds : [])
          .map((id: any) => id?._id?.toString?.() ?? id?.toString?.() ?? String(id))
          .map((id: string) => id.trim())
          .filter((id: string) => /^[0-9a-fA-F]{24}$/.test(id))
      )
    );
    presenceWatchUserIdsRef.current = normalized;
    setPresenceWatchUserIdsState(normalized);
  }, []);
  
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

  // Keep latest selectedConversationId and partner ID in refs for listeners / presence.
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId;
  }, [selectedConversationId]);
  useEffect(() => {
    selectedConversationPartnerIdRef.current = selectedConversationPartnerId;
  }, [selectedConversationPartnerId]);

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

    newMessageHandlerBodyRef.current = (messageData: any) => {
      if (!messageData || !messageData.sender || !user?._id) return;

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

      if (!isFromCurrentUser && messageData._id) {
        try {
          socketService.emit('ackMessageDelivered', { messageId: String(messageData._id) });
        } catch (_) {
          /* ignore */
        }
      }

      const conversationId = messageData.conversationId?.toString();
      const openId = selectedConversationIdRef.current;
      const isFromOpenConversation =
        !!openId &&
        !!conversationId &&
        openId.toString() === conversationId.toString();

      const shouldPlay = !isFromCurrentUser && !isFromOpenConversation;

      console.log('🔔 [SocketContext] Message notification check:', {
        sender: messageSenderId,
        openConversation: openId || 'none',
        isFromMe: isFromCurrentUser,
        isFromOpenChat: isFromOpenConversation,
        willPlaySound: shouldPlay,
      });

      if (shouldPlay) {
        playNotificationSound('message');
        Vibration.vibrate(400);
      }
    };

    // Re-bind all app-wide listeners whenever a new Socket.IO instance is created (reconnect / replace).
    // Otherwise handlers stay on the old socket and chessChallenge / posts / etc. never fire.
    const installCoreSocketListeners = () => {
    socketService.off('getOnlineUser');
    socketService.off('presenceSnapshot');
    socketService.off('presenceUpdate');
    socketService.off(SOCKET_EVENTS.NEW_POST);
    socketService.off(SOCKET_EVENTS.POST_UPDATED);
    socketService.off(SOCKET_EVENTS.POST_DELETED);
    socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
    socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
    socketService.off(SOCKET_EVENTS.CHESS_MOVE);
    socketService.off(SOCKET_EVENTS.CARD_CHALLENGE);
    socketService.off(SOCKET_EVENTS.CARD_MOVE);
    socketService.off('newNotification');
    socketService.off('newMessage', onNewMessageForSocket);

    console.log('🔧 [SocketContext] Installing core socket listeners');

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
    socketService.on(SOCKET_EVENTS.NEW_POST, (payload) => {
      console.log('📩 New post received:', payload);
      
      // Backend may send either:
      // 1. Direct post object: { _id: ..., text: ..., ... }
      // 2. Wrapped object: { postId: ..., post: { _id: ..., text: ..., ... } }
      let post = payload;
      if (payload && payload.post && typeof payload.post === 'object') {
        // It's wrapped: { postId: ..., post: {...} }
        post = payload.post;
        // Ensure _id is set from postId if missing
        if (!post._id && payload.postId) {
          post._id = payload.postId;
        }
        console.log('📦 [SocketContext] Unwrapped post from payload:', { 
          postId: payload.postId, 
          postIdFromPost: post._id,
          hasId: !!post._id
        });
      }
      
      // Validate post has _id before proceeding
      if (!post || !post._id) {
        console.error('❌ [SocketContext] Post missing _id field:', { 
          payload, 
          post, 
          hasPost: !!post,
          hasId: !!post?._id,
          postId: payload?.postId
        });
        return;
      }
      
      // Check if it's a chess or card game post - these should always be added (backend only emits to followers)
      const isChessPost = !!post?.chessGameData;
      const isCardPost = !!post?.cardGameData;
      
      if (isChessPost || isCardPost) {
        // Game posts: Backend already filters to only send to followers, so always add
        const gameType = isChessPost ? 'chess' : 'card';
        console.log(`✅ [SocketContext] Adding ${gameType} game post to feed:`, post._id);
        addPost(post);
        return;
      }

      // Live channel posts this user added via "Watch live" (any channel username — not only AlJazeera)
      const channelOwnerId =
        post?.channelAddedBy?.toString?.() ?? (post?.channelAddedBy != null ? String(post.channelAddedBy) : '');
      const myId = user?._id?.toString?.() ?? (user?._id != null ? String(user._id) : '');
      const isMyChannelPost = !!channelOwnerId && !!myId && channelOwnerId === myId;
      if (isMyChannelPost) {
        console.log('✅ [SocketContext] Adding live channel post you added:', post._id);
        addPost(post);
        return;
      }
      
      // For regular posts, check if user follows the author
      if (post?.postedBy?._id || post?.postedBy) {
        const authorId = post.postedBy._id?.toString?.() || post.postedBy.toString?.() || post.postedBy;
        // Own posts: only prepend if collaborative with at least one other contributor (matches getFeedPost)
        if (myId && authorId === myId) {
          const contributors = post.contributors;
          const hasOtherContributor =
            !!post.isCollaborative &&
            Array.isArray(contributors) &&
            contributors.some((c: any) => {
              const cid = (c?._id != null ? c._id : c)?.toString?.() ?? String(c);
              return cid && cid !== myId;
            });
          if (!hasOtherContributor) {
            console.log('⚠️ [SocketContext] Ignoring own post for feed:', post._id);
            return;
          }
          console.log('✅ [SocketContext] Adding own collaborative post to feed:', post._id);
          addPost(post);
          return;
        }
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
        console.warn('⚠️ [SocketContext] Post missing postedBy field, ignoring:', post._id);
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
      let postId = null;
      
      if (payload) {
        if (typeof payload === 'string') {
          postId = payload;
        } else if (payload.postId) {
          // Handle both string and ObjectId formats
          if (typeof payload.postId === 'string') {
            postId = payload.postId;
          } else if (payload.postId?.toString) {
            postId = payload.postId.toString();
          } else {
            postId = String(payload.postId);
          }
        } else if (payload.toString) {
          postId = payload.toString();
        } else {
          postId = String(payload);
        }
      }
      
      // Normalize to string and trim
      if (postId && typeof postId !== 'string') {
        postId = postId.toString();
      }
      if (postId) {
        postId = postId.trim();
      }
      
      console.log('🗑️ [SocketContext] Post deleted event received:', { 
        payload, 
        postId,
        payloadType: typeof payload,
        postIdType: typeof postId,
        postIdLength: postId?.length
      });
      
      if (postId) {
        console.log('✅ [SocketContext] Removing post from feed:', postId);
        try {
          deletePost(postId);
          console.log('✅ [SocketContext] Successfully called deletePost for:', postId);
        } catch (error) {
          console.error('❌ [SocketContext] Error removing post from feed:', error, { postId });
        }
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

    socketService.on('newMessage', onNewMessageForSocket);
    };

    // Subscribe to targeted presence updates (followers + following + conversation partner USER ID)
    // Backend expects userIds (user _id), not conversation doc ids. Partner = other user in chat.
    const subscribeToPresence = () => {
      if (!socketService.isSocketConnected()) {
        console.log('⏳ [SocketContext] Socket not connected yet, will subscribe on connect');
        return;
      }
      
      try {
        const followingIds = (user?.following || []).map((x: any) => (x?._id ?? x)?.toString?.() ?? String(x));
        const followerIds = (user?.followers || []).map((x: any) => (x?._id ?? x)?.toString?.() ?? String(x));
        const partnerUserId = selectedConversationPartnerIdRef.current;
        const watchedIds = presenceWatchUserIdsRef.current || [];
        const allIds = [...followingIds, ...followerIds, ...watchedIds];
        if (partnerUserId) {
          const s = partnerUserId.toString();
          if (!allIds.includes(s)) allIds.push(s);
        }
        const uniqueIds = Array.from(new Set(allIds)).filter(Boolean);
        
        if (uniqueIds.length > 0) {
          console.log(`📡 [SocketContext] Subscribing to presence for ${uniqueIds.length} users (following: ${followingIds.length}, followers: ${followerIds.length}, watched: ${watchedIds.length}, partner: ${partnerUserId ? 'yes' : 'no'})`);
          socketService.emit('presenceSubscribe', { userIds: uniqueIds });
        }
      } catch (e) {
        console.error('❌ [SocketContext] Error subscribing to presence:', e);
      }
    };
    
    presenceSubscribeRef.current = subscribeToPresence;
    installCoreSocketListeners();
    const removeSocketReady = socketService.addSocketReadyListener(installCoreSocketListeners);
    subscribeToPresence();

    const removeConnectListener = socketService.addConnectListener(() => {
      console.log('🔌 [SocketContext] Socket connected - subscribing presence');
      subscribeToPresence();

      // Flush pending delivery acks queued from FCM (push arrived while socket was disconnected).
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_DELIVERY_ACKS);
          if (!raw) return;
          const ids = (JSON.parse(raw) as any) as string[];
          const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((x) => String(x).trim()).filter(Boolean))).slice(0, 50);
          if (!uniqueIds.length) return;
          socketService.emit('ackMessageDelivered', { messageIds: uniqueIds });
          await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_DELIVERY_ACKS);
        } catch (e) {
          // keep for next connect
        }
      })();
    });

    // If an FCM message arrives while socket is already connected, flush delivery acks immediately
    // so sender ticks update ASAP (✓ -> ✓✓).
    const fcmSub = DeviceEventEmitter.addListener('MessageFromFCM', () => {
      if (!socketService.isSocketConnected()) return;
      (async () => {
        try {
          const raw = await AsyncStorage.getItem(STORAGE_KEYS.PENDING_DELIVERY_ACKS);
          if (!raw) return;
          const ids = (JSON.parse(raw) as any) as string[];
          const uniqueIds = Array.from(
            new Set((Array.isArray(ids) ? ids : []).map((x) => String(x).trim()).filter(Boolean))
          ).slice(0, 50);
          if (!uniqueIds.length) return;
          socketService.emit('ackMessageDelivered', { messageIds: uniqueIds });
          await AsyncStorage.removeItem(STORAGE_KEYS.PENDING_DELIVERY_ACKS);
        } catch {
          // best-effort
        }
      })();
    });

    return () => {
      fcmSub.remove();
      removeSocketReady();
      removeConnectListener();
      socketService.off('getOnlineUser');
      socketService.off('presenceSnapshot');
      socketService.off('presenceUpdate');
      socketService.off(SOCKET_EVENTS.NEW_POST);
      socketService.off(SOCKET_EVENTS.POST_UPDATED);
      socketService.off(SOCKET_EVENTS.POST_DELETED);
      socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
      socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
      socketService.off(SOCKET_EVENTS.CHESS_MOVE);
      socketService.off(SOCKET_EVENTS.CARD_CHALLENGE);
      socketService.off(SOCKET_EVENTS.CARD_MOVE);
      socketService.off('newNotification');
      socketService.off('newMessage', onNewMessageForSocket);
    };
  }, [user?._id, addPost, updatePost, deletePost, playNotificationSound, onNewMessageForSocket]);

  // Re-subscribe to presence when following, followers, or conversation partner changes (no listener re-register).
  useEffect(() => {
    if (!user?._id) return;
    const sub = presenceSubscribeRef.current;
    if (sub) sub();
  }, [user?._id, user?.following, user?.followers, selectedConversationPartnerId, presenceWatchUserIds]);

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
      selectedConversationPartnerId,
      setSelectedConversationPartnerId,
      setPresenceWatchUserIds,
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
