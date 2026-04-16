import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  Alert,
  AppState,
  ScrollView,
} from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useWebRTC } from '../../context/WebRTCContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import WebView from 'react-native-webview';
import { useLanguage } from '../../context/LanguageContext';

/** `delivered` only after recipient app acks (WhatsApp-style). Missing field should stay conservative (sent). */
function isOutgoingDeliveredForTicks(item: any) {
  if (item.seen === true) return true;
  if (item.delivered === true) return true;
  if (item.delivered === false) return false;
  return false;
}

function collectUndeliveredIncomingIds(
  messagesData: any[],
  currentUserIdStr: string,
  getSenderId: (s: any) => string
): string[] {
  const ids: string[] = [];
  for (const m of messagesData) {
    if (!m?._id || m.delivered !== false) continue;
    const sid = getSenderId(m.sender);
    if (sid && sid !== currentUserIdStr) ids.push(String(m._id));
  }
  return ids.slice(0, 50);
}

/** WhatsApp-style: light green outgoing, white incoming; tick colors match WA semantics */
const WA = {
  outgoingBg: '#DCF8C6',
  incomingBg: '#FFFFFF',
  outgoingText: '#111B21',
  metaTimeOwn: '#667781',
  /** Sent (✓) & delivered-not-read (✓✓): same gray; blue only after read */
  tickUnseen: '#54656F',
  tickRead: '#53BDEB',
  incomingBorder: '#E5E5EA',
  replyBgOwn: 'rgba(0, 0, 0, 0.06)',
  replyBgOther: '#F0F2F5',
  replyBarOwn: '#128C7E',
} as const;

const ChatScreen = ({ route, navigation }: any) => {
  const { conversationId, userId, otherUser, isGroup, groupName, conversation: groupConversation } = route.params || {};
  const { user } = useUser();
  const { socket, isUserOnline, isUserBusy, setSelectedConversationId, setSelectedConversationPartnerId, refreshPresenceSubscription } = useSocket();
  const { callUser, isCalling, callAccepted, callEnded } = useWebRTC();
  const { colors, theme } = useTheme();

  /** Incoming bubbles are fixed white in WA; in dark theme that forced white-on-white with `colors.text`. */
  const incomingBubbleStyle = useMemo(
    () =>
      theme === 'dark'
        ? {
            backgroundColor: colors.backgroundLight,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
          }
        : {
            backgroundColor: WA.incomingBg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: WA.incomingBorder,
          },
    [theme, colors.backgroundLight, colors.border]
  );
  const incomingMainTextColor = theme === 'dark' ? colors.text : WA.outgoingText;
  const incomingReplySurfaceColor = theme === 'dark' ? 'rgba(255,255,255,0.08)' : WA.replyBgOther;
  const { t } = useLanguage();
  const [messages, setMessages] = useState<any[]>([]);
  const messagesRef = useRef<any[]>([]);
  messagesRef.current = messages;
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false); // Start false to avoid flash
  const [sending, setSending] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(conversationId);
  const [pendingMedia, setPendingMedia] = useState<any | null>(null); // ImagePicker asset
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<any | null>(null);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingMoreMessages, setLoadingMoreMessages] = useState(false);
  const messagesEndRef = useRef<FlatList>(null);
  const isCallInProgressRef = useRef(false); // Prevent duplicate calls
  const initiatedCallAtRef = useRef<number>(0); // When we set ref true (avoid reset during 300ms delay)
  const shouldAutoScrollRef = useRef(true);
  const isSendingRef = useRef(false);
  const hasMarkedSeenRef = useRef(false); // Prevent duplicate markmessageasSeen emits
  const lastForegroundRefreshAtRef = useRef(0); // Debounce app-active refresh
  const ignoreNextForegroundRefreshRef = useRef(false); // Image picker can trigger inactive->active
  const lastScrollOffsetRef = useRef(0);
  const previousScrollYRef = useRef(0); // Only load older when user scrolls UP into top zone (not on initial short list)
  const loadingMoreRef = useRef(false); // Guard to prevent double load when scrolling fast
  const estimatedMessageHeight = 72; // For scroll position after prepending (same as web pagination)
  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [isPartnerTyping, setIsPartnerTyping] = useState(false);

  const toIdString = useCallback((value: any): string => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      if (typeof value.$oid === 'string') return value.$oid;
      if (value._id) return toIdString(value._id);
      if (typeof value.toString === 'function') {
        const parsed = value.toString();
        if (parsed && parsed !== '[object Object]') return parsed;
      }
      try {
        const raw = JSON.stringify(value);
        const match = raw.match(/[0-9a-fA-F]{24}/);
        if (match) return match[0];
      } catch (_) {
        // ignore
      }
      return '';
    }
    return String(value);
  }, []);

  const routeConversationIdStr = useMemo(() => toIdString(conversationId), [conversationId, toIdString]);
  const routeGroupConversationIdStr = useMemo(() => toIdString(groupConversation?._id), [groupConversation?._id, toIdString]);

  const currentUserIdStr = useMemo(() => (user?._id?.toString?.() ?? String(user?._id ?? '')), [user?._id]);
  
  // Track current conversation ID with ref (like web version)
  const currentConversationIdRef = useRef<string | null>(null);

  const getSenderId = useCallback((sender: any) => {
    return sender?._id?.toString?.() ?? sender?.toString?.() ?? (sender ? String(sender) : '');
  }, []);

  const partnerPresenceId = useMemo(
    () =>
      otherUser?._id != null
        ? String(otherUser._id)
        : userId != null
          ? String(userId)
          : '',
    [otherUser?._id, userId]
  );
  const isPartnerOnline = useMemo(
    () => isUserOnline(partnerPresenceId),
    [isUserOnline, partnerPresenceId]
  );
  const isPartnerBusy = useMemo(
    () => isUserBusy(partnerPresenceId),
    [isUserBusy, partnerPresenceId]
  );

  const isVideoUrl = (url: string) => {
    if (!url) return false;
    return url.includes('/video/upload/') || /\.(mp4|webm|ogg|mov)$/i.test(url);
  };
  const optimizeCloudinaryMediaUrl = useCallback((rawUrl: string, kind: 'image' | 'video') => {
    const url = String(rawUrl || '');
    if (!url.includes('res.cloudinary.com')) return url;
    if (kind === 'video') {
      if (!url.includes('/video/upload/')) return url;
      return url.replace('/video/upload/', '/video/upload/f_auto,q_auto:eco,vc_auto/');
    }
    if (!url.includes('/image/upload/')) return url;
    return url.replace('/image/upload/', '/image/upload/f_auto,q_auto:eco,dpr_auto/');
  }, []);

  const handleNewMessage = useCallback((data: any) => {
    // Ignore own messages — handleSend already adds them optimistically
    const messageSenderId = data.sender?._id?.toString() || data.sender?.toString() || data.sender;
    const currentUserId = user?._id?.toString();
    const isFromCurrentUser = messageSenderId && currentUserId && messageSenderId === currentUserId;
    if (isFromCurrentUser) return;

    // Handle messages for current conversation - Use REF (like web version)
    const currentConvId = currentConversationIdRef.current;
    const msgConvId =
      data.conversationId != null
        ? (typeof data.conversationId === 'string' ? data.conversationId : data.conversationId.toString?.() ?? String(data.conversationId))
        : '';
    const curConvStr =
      currentConvId != null
        ? typeof currentConvId === 'string' ? currentConvId : currentConvId.toString?.() ?? String(currentConvId)
        : '';
    const partnerIdStr = (otherUser?._id?.toString?.() ?? (userId != null ? String(userId) : '')) || '';
    const senderRaw = data.sender;
    const senderStr =
      typeof senderRaw === 'string' || typeof senderRaw === 'number'
        ? String(senderRaw)
        : senderRaw?._id?.toString?.() ?? (senderRaw ? String(senderRaw) : '');

    if (
      (msgConvId && msgConvId === curConvStr) ||
      (msgConvId && !curConvStr && partnerIdStr && senderStr === partnerIdStr)
    ) {
      if (!currentConvId && data.conversationId) {
        setCurrentConversationId(toIdString(data.conversationId));
      }

      setMessages((prev) => {
        const isDuplicate = prev.some(msg =>
          msg._id && data._id && msg._id.toString() === data._id.toString()
        );
        if (isDuplicate) return prev;
        // While this screen is open, each new incoming message must mark the partner's messages as
        // seen (fetchMessages only emits markmessageasSeen once). Otherwise the sender never gets
        // `messagesSeen` and ticks stay gray even when both users are in the chat.
        const convForSeen = curConvStr || msgConvId || toIdString(data.conversationId);
        const isGroupConv = !!(isGroup || groupConversation?.isGroup);
        const partnerForSeen = isGroupConv ? null : (otherUser?._id ?? (userId != null ? userId : null));
        if (socket && convForSeen && user?._id && (isGroupConv || partnerForSeen)) {
          socket.emit('markmessageasSeen', { conversationId: convForSeen, userId: partnerForSeen });
        }
        return [...prev, data];
      });
      
      // Inverted list: offset 0 is the latest (bottom)
      // Only auto-scroll if user is already near the bottom; don't disrupt if they're reading older messages.
      if (shouldAutoScrollRef.current) {
        requestAnimationFrame(() => {
          try {
            (messagesEndRef.current as any)?.scrollToOffset?.({ offset: 0, animated: true });
          } catch (_) {}
        });
        setTimeout(() => {
          try {
            (messagesEndRef.current as any)?.scrollToOffset?.({ offset: 0, animated: true });
          } catch (_) {}
        }, 80);
      }
    }
  }, [user?._id, userId, otherUser?._id, socket, isGroup, groupConversation?.isGroup, toIdString]);

  // Real-time: reaction on a message – backend emits messageReactionUpdated with { conversationId, messageId } (same as web)
  const handleMessageReactionUpdated = useCallback(async (data: { conversationId?: string; messageId?: string }) => {
    const convId = data?.conversationId?.toString?.() ?? data?.conversationId;
    const currentConvId = currentConversationIdRef.current?.toString?.() ?? currentConversationIdRef.current;
    if (!convId || convId !== currentConvId) return;

    // Backend only sends conversationId + messageId; refetch messages to get updated reactions (same as web)
    try {
      const isGroupConv = !!(isGroup || groupConversation?.isGroup);
      const existingConversationId = toIdString(currentConversationIdRef.current) || routeConversationIdStr || routeGroupConversationIdStr;
      const groupConvId = existingConversationId;
      const otherUserId = otherUser?._id ?? userId;
      if (!existingConversationId && !isGroupConv && !otherUserId) return;
      if (isGroupConv && !groupConvId) return;
      const url = existingConversationId
        ? `${ENDPOINTS.GET_MESSAGES}/${String(existingConversationId)}?conversationId=${String(existingConversationId)}&limit=${MESSAGE_PAGE_SIZE}`
        : `${ENDPOINTS.GET_MESSAGES}/${typeof otherUserId === 'string' ? otherUserId : (otherUserId as any)?._id ?? otherUserId}?limit=${MESSAGE_PAGE_SIZE}`;
      const response = await apiService.get(url);
      const messagesData = response?.messages ?? (Array.isArray(response) ? response : []);
      setMessages(messagesData);
    } catch (e) {
      console.warn('❌ [ChatScreen] messageReactionUpdated refetch failed:', e);
    }
  }, [otherUser?._id, userId, isGroup, groupConversation?.isGroup, routeConversationIdStr, routeGroupConversationIdStr, toIdString]);

  // Real-time: message deleted – backend emits messageDeleted with { conversationId, messageId } (same as web)
  const handleMessagesSeen = useCallback(
    (data: { conversationId?: string }) => {
      const cid = data?.conversationId != null ? String(data.conversationId) : '';
      const myConv =
        (currentConversationIdRef.current ?? conversationId) != null
          ? String(currentConversationIdRef.current ?? conversationId)
          : '';
      if (cid && myConv && cid !== myConv) return;

      setMessages((prev) =>
        prev.map((msg) => {
          const sid = getSenderId(msg.sender);
          if (sid === currentUserIdStr && !msg.seen) {
            return { ...msg, seen: true };
          }
          return msg;
        })
      );
    },
    [conversationId, currentUserIdStr, getSenderId]
  );

  const handleUserTyping = useCallback(
    (data: { userId?: string; conversationId?: string; isTyping?: boolean }) => {
      const isGroupConv = !!(isGroup || groupConversation?.isGroup);
      const fromStr = data?.userId != null ? String(data.userId) : '';

      if (isGroupConv) {
        // Group: show typing for anyone in the group except ourselves
        if (!fromStr || fromStr === currentUserIdStr) return;
      } else {
        // 1-to-1: only show if from our chat partner
        const partnerStr = (otherUser?._id?.toString?.() ?? (userId != null ? String(userId) : '')) || '';
        if (!partnerStr || fromStr !== partnerStr) return;
      }

      const evtConv = data.conversationId != null ? String(data.conversationId) : '';
      const myConv =
        (currentConversationIdRef.current ?? conversationId) != null
          ? String(currentConversationIdRef.current ?? conversationId)
          : '';
      if (evtConv && myConv && evtConv !== myConv) return;
      if (evtConv && !myConv) return;

      if (partnerTypingClearTimeoutRef.current) {
        clearTimeout(partnerTypingClearTimeoutRef.current);
        partnerTypingClearTimeoutRef.current = null;
      }

      setIsPartnerTyping(!!data.isTyping);
      if (data.isTyping) {
        // Auto-clear after 3.5s in case typingStop is never received (network loss, crash)
        partnerTypingClearTimeoutRef.current = setTimeout(() => {
          setIsPartnerTyping(false);
          partnerTypingClearTimeoutRef.current = null;
        }, 3500);
      }
    },
    [otherUser?._id, userId, conversationId, isGroup, groupConversation?.isGroup, currentUserIdStr]
  );

  const handleMessageDeleted = useCallback((data: { conversationId?: string; messageId?: string }) => {
    const convId = data?.conversationId?.toString?.() ?? data?.conversationId;
    const currentConvId = currentConversationIdRef.current?.toString?.() ?? currentConversationIdRef.current;
    if (!convId || convId !== currentConvId) return;

    const messageId = (data?.messageId ?? (data as any)?._id)?.toString?.();
    if (!messageId) return;

    setMessages((prev) => prev.filter((m) => (m._id?.toString?.() ?? String(m._id)) !== messageId));
  }, []);

  const handleMessageDelivered = useCallback(
    (data: { messageId?: string; conversationId?: string }) => {
      const cid = data?.conversationId != null ? String(data.conversationId) : '';
      const myConv =
        (currentConversationIdRef.current ?? conversationId) != null
          ? String(currentConversationIdRef.current ?? conversationId)
          : '';
      if (cid && myConv && cid !== myConv) return;

      const mid = data?.messageId != null ? String(data.messageId) : '';
      if (!mid) return;

      setMessages((prev) =>
        prev.map((m) =>
          (m._id?.toString?.() ?? String(m._id)) === mid ? { ...m, delivered: true } : m
        )
      );
    },
    [conversationId]
  );

  // Update current conversation ID ref whenever it changes
  useEffect(() => {
    currentConversationIdRef.current = toIdString(currentConversationId) || routeConversationIdStr || null;
  }, [currentConversationId, routeConversationIdStr, toIdString]);

  // Set up socket listeners: newMessage, messageReactionUpdated, messageDeleted (match backend + web)
  useEffect(() => {
    if (!socket || !user?._id) return;

    const handleGroupDeleted = ({ conversationId: deletedId }: { conversationId: string }) => {
      const thisId = toIdString(currentConversationId) || routeConversationIdStr;
      if (deletedId && String(deletedId) === String(thisId)) {
        Alert.alert(t('groupDeletedTitle'), t('groupDeletedByAdmin'));
        navigation.pop(1);
      }
    };

    const bind = () => {
      // If the socket instance was recreated on reconnect, ensure our listeners are attached to the new one.
      socket.off('newMessage', handleNewMessage);
      socket.off('messageReactionUpdated', handleMessageReactionUpdated);
      socket.off('messageDeleted', handleMessageDeleted);
      socket.off('messagesSeen', handleMessagesSeen);
      socket.off('userTyping', handleUserTyping);
      socket.off('messageDelivered', handleMessageDelivered);
      socket.off('groupDeleted', handleGroupDeleted);
      socket.on('newMessage', handleNewMessage);
      socket.on('messageReactionUpdated', handleMessageReactionUpdated);
      socket.on('messageDeleted', handleMessageDeleted);
      socket.on('messagesSeen', handleMessagesSeen);
      socket.on('userTyping', handleUserTyping);
      socket.on('messageDelivered', handleMessageDelivered);
      socket.on('groupDeleted', handleGroupDeleted);
    };

    // Bind now (current socket instance)
    bind();

    // Re-bind on every new socket instance created by SocketService.connect()
    const removeReady =
      (socket as any)?.addSocketReadyListener?.(bind) ?? null;

    return () => {
      removeReady?.();
      socket.off('newMessage', handleNewMessage);
      socket.off('messageReactionUpdated', handleMessageReactionUpdated);
      socket.off('messageDeleted', handleMessageDeleted);
      socket.off('messagesSeen', handleMessagesSeen);
      socket.off('userTyping', handleUserTyping);
      socket.off('messageDelivered', handleMessageDelivered);
      socket.off('groupDeleted', handleGroupDeleted);
    };
  }, [
    socket,
    user?._id,
    handleNewMessage,
    handleMessageReactionUpdated,
    handleMessageDeleted,
    handleMessagesSeen,
    handleUserTyping,
    handleMessageDelivered,
    navigation,
    currentConversationId,
    routeConversationIdStr,
    toIdString,
  ]);

  useEffect(() => {
    return () => {
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      if (partnerTypingClearTimeoutRef.current) {
        clearTimeout(partnerTypingClearTimeoutRef.current);
        partnerTypingClearTimeoutRef.current = null;
      }
    };
  }, []);

  const emitTypingStop = useCallback(() => {
    if (!socket || !user?._id) return;
    const isGroupConv = !!(isGroup || groupConversation?.isGroup);
    const conv = toIdString(currentConversationIdRef.current) || routeConversationIdStr || routeGroupConversationIdStr;
    if (isGroupConv) {
      if (!conv) return;
      socket.emit('typingStop', { from: user._id, conversationId: conv, isGroup: true });
    } else {
      const toId = (otherUser?._id ?? userId) != null ? String(otherUser?._id ?? userId) : '';
      if (!toId) return;
      socket.emit('typingStop', { from: user._id, to: toId, conversationId: conv || undefined });
    }
  }, [socket, user?._id, otherUser?._id, userId, routeConversationIdStr, routeGroupConversationIdStr, isGroup, groupConversation?.isGroup, toIdString]);

  const handleMessageTextChange = useCallback(
    (text: string) => {
      setNewMessage(text);
      if (!socket || !user?._id) return;
      const isGroupConv = !!(isGroup || groupConversation?.isGroup);
      const conv = toIdString(currentConversationIdRef.current) || routeConversationIdStr || routeGroupConversationIdStr;
      if (isGroupConv) {
        if (!conv) return;
        socket.emit('typingStart', { from: user._id, conversationId: conv, isGroup: true });
      } else {
        const toId = (otherUser?._id ?? userId) != null ? String(otherUser?._id ?? userId) : '';
        if (!toId) return;
        socket.emit('typingStart', { from: user._id, to: toId, conversationId: conv || undefined });
      }
      if (typingStopTimeoutRef.current) {
        clearTimeout(typingStopTimeoutRef.current);
        typingStopTimeoutRef.current = null;
      }
      typingStopTimeoutRef.current = setTimeout(() => {
        emitTypingStop();
        typingStopTimeoutRef.current = null;
      }, 2000);
    },
    [socket, user?._id, otherUser?._id, userId, routeConversationIdStr, routeGroupConversationIdStr, isGroup, groupConversation?.isGroup, emitTypingStop, toIdString]
  );

  // Emit joinConversationRoom for groups so the user is always in the Socket.IO room,
  // even when they were added to the group after their initial connection.
  useEffect(() => {
    const isGroupConv = !!(isGroup || groupConversation?.isGroup);
    const groupConvId = routeConversationIdStr || routeGroupConversationIdStr;
    if (!isGroupConv || !groupConvId || !socket || !user?._id) return;
    socket.emit('joinConversationRoom', { conversationId: String(groupConvId) });
  }, [isGroup, groupConversation?.isGroup, routeConversationIdStr, routeGroupConversationIdStr, socket, user?._id]);

  useEffect(() => {
    hasMarkedSeenRef.current = false;
    previousScrollYRef.current = 0;

    if (routeConversationIdStr) {
      setCurrentConversationId(routeConversationIdStr);
      setTimeout(() => { fetchMessages(); }, 50);
    } else if (userId && otherUser) {
      setLoading(false);
    } else if (otherUser?._id) {
      setTimeout(() => { fetchMessages(); }, 50);
    } else {
      setLoading(false);
    }
  }, [routeConversationIdStr, userId, otherUser?._id, user?._id]);

  // Track currently open conversation globally (used to avoid incrementing unread while viewing)
  useEffect(() => {
    const id = toIdString(currentConversationId) || routeConversationIdStr || null;
    setSelectedConversationId(id);
    const partnerId = otherUser?._id != null ? String(otherUser._id) : null;
    setSelectedConversationPartnerId(partnerId);
    return () => {
      setSelectedConversationId(null);
      setSelectedConversationPartnerId(null);
    };
  }, [setSelectedConversationId, setSelectedConversationPartnerId, currentConversationId, routeConversationIdStr, otherUser?._id, toIdString]);

  useFocusEffect(
    useCallback(() => {
      refreshPresenceSubscription();
    }, [refreshPresenceSubscription])
  );
  
  // Reset call in progress flag when call ends or is canceled so user can call again
  useEffect(() => {
    if (callEnded) {
      isCallInProgressRef.current = false;
      initiatedCallAtRef.current = 0;
      return;
    }
    if (!isCalling && !callAccepted && initiatedCallAtRef.current) {
      const elapsed = Date.now() - initiatedCallAtRef.current;
      if (elapsed < 400) return;
      isCallInProgressRef.current = false;
      initiatedCallAtRef.current = 0;
    }
  }, [isCalling, callAccepted, callEnded]);

  // Page size for messages (same as web – avoids server load)
  const MESSAGE_PAGE_SIZE = 12;

  const fetchMessages = useCallback(async (loadMore = false, beforeId: string | null = null) => {
    const isGroupConv = isGroup || groupConversation?.isGroup;
    const existingConversationId = toIdString(currentConversationId) || routeConversationIdStr || routeGroupConversationIdStr;
    const groupConvId = existingConversationId;

    // For 1-to-1, resolve the other user's ID as before
    const otherUserId = !isGroupConv ? (otherUser?._id || userId || (route.params?.otherUser?._id) || (route.params?.userId)) : null;

    // If we have a conversation id (from list/opened chat), always fetch by conversationId.
    // This mirrors web behavior and avoids relying on isGroup detection from route state.
    if (!existingConversationId && !isGroupConv && !otherUserId) {
      if (!loadMore) setLoading(false);
      return;
    }
    if (isGroupConv && !groupConvId) {
      if (!loadMore) setLoading(false);
      return;
    }

    const otherUserIdStr = !isGroupConv
      ? (typeof otherUserId === 'string' ? otherUserId : String((otherUserId as any)?._id ?? otherUserId))
      : 'group';

    if (loadMore) {
      loadingMoreRef.current = true;
      setLoadingMoreMessages(true);
    } else {
      setLoading(true);
    }

    try {
      let url = '';
      if (existingConversationId) {
        url = `${ENDPOINTS.GET_MESSAGES}/${String(existingConversationId)}?limit=${MESSAGE_PAGE_SIZE}&conversationId=${String(existingConversationId)}`;
      } else {
        url = `${ENDPOINTS.GET_MESSAGES}/${otherUserIdStr}?limit=${MESSAGE_PAGE_SIZE}`;
      }
      if (beforeId) url += `&beforeId=${beforeId}`;

      const response = await apiService.get(url);
      const messagesData = response?.messages ?? (Array.isArray(response) ? response : []);
      const hasMore = response?.hasMore === true;

      if (loadMore && beforeId) {
        loadingMoreRef.current = false;
        setHasMoreMessages(hasMore);
        setLoadingMoreMessages(false);
        if (messagesData.length > 0) {
          setMessages((prev) => {
            const combined = [...messagesData, ...prev];
            if (combined.length > 200) return combined.slice(0, 200);
            return combined;
          });
          const ackIds = collectUndeliveredIncomingIds(
            messagesData,
            currentUserIdStr,
            getSenderId
          );
          if (socket && ackIds.length) {
            socket.emit('ackMessageDelivered', { messageIds: ackIds });
          }
          const prependedCount = messagesData.length;
          setTimeout(() => {
            messagesEndRef.current?.scrollToOffset({
              offset: lastScrollOffsetRef.current + prependedCount * estimatedMessageHeight,
              animated: false,
            });
          }, 80);
        }
        return;
      }

      setMessages(messagesData);
      const ackIds = collectUndeliveredIncomingIds(messagesData, currentUserIdStr, getSenderId);
      if (socket && ackIds.length) {
        socket.emit('ackMessageDelivered', { messageIds: ackIds });
      }
      setHasMoreMessages(hasMore);

      const isGroupConv = !!(isGroup || groupConversation?.isGroup);
      const convId = toIdString(currentConversationId) || routeConversationIdStr || routeGroupConversationIdStr;
      const partnerId = isGroupConv ? null : (otherUser?._id ?? userId);
      const sk = socket as { isSocketConnected?: () => boolean; emit: (e: string, p?: unknown) => void };
      // Only set hasMarkedSeenRef when the socket is actually connected — socketService.emit no-ops
      // if TCP is not up yet; setting the ref anyway used to skip mark-seen forever (kill app / cold start).
      if (
        convId &&
        user?._id &&
        (isGroupConv || partnerId) &&
        !hasMarkedSeenRef.current &&
        typeof sk.isSocketConnected === 'function' &&
        sk.isSocketConnected()
      ) {
        hasMarkedSeenRef.current = true;
        sk.emit('markmessageasSeen', { conversationId: convId, userId: partnerId });
      }

      // With an inverted list, the newest messages are naturally visible without forcing scrollToEnd.
    } catch (error: any) {
      if (!loadMore) setMessages([]);
      loadingMoreRef.current = false;
      setLoadingMoreMessages(false);
      setLoading(false);
      return;
    } finally {
      if (!loadMore) setLoading(false);
    }
  }, [
    otherUser?._id,
    userId,
    routeConversationIdStr,
    routeGroupConversationIdStr,
    currentConversationId,
    socket,
    user?._id,
    currentUserIdStr,
    getSenderId,
    toIdString,
  ]);

  // After socket connects/reconnects, ack delivery + mark conversation read (fetch may have run before TCP was up).
  useEffect(() => {
    const sk = socket as any;
    if (!sk || typeof sk.addConnectListener !== 'function') return;
    const remove = sk.addConnectListener(() => {
      setTimeout(() => {
        const ackIds = collectUndeliveredIncomingIds(
          messagesRef.current,
          currentUserIdStr,
          getSenderId
        );
        if (ackIds.length) {
          sk.emit?.('ackMessageDelivered', { messageIds: ackIds });
        }
        const isGroupConv = !!(isGroup || groupConversation?.isGroup);
        const convId = toIdString(currentConversationIdRef.current) || routeConversationIdStr || routeGroupConversationIdStr;
        const partnerId = isGroupConv ? null : (otherUser?._id ?? userId);
        if (convId && user?._id && (isGroupConv || partnerId) && sk.isSocketConnected?.()) {
          sk.emit?.('markmessageasSeen', { conversationId: convId, userId: partnerId });
          hasMarkedSeenRef.current = true;
        }
      }, 500);
    });
    return () => remove?.();
  }, [socket, currentUserIdStr, getSenderId, routeConversationIdStr, routeGroupConversationIdStr, groupConversation?.isGroup, isGroup, otherUser?._id, userId, user?._id, toIdString]);

  // When returning from background, refresh messages + re-mark as seen.
  // This prevents "push stops but chat list still stale until I leave and come back".
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (ignoreNextForegroundRefreshRef.current) {
        ignoreNextForegroundRefreshRef.current = false;
        return;
      }
      if (!socket || !user?._id) return;
      if (isCalling || callAccepted) return;

      const now = Date.now();
      if (now - lastForegroundRefreshAtRef.current < 800) return;
      lastForegroundRefreshAtRef.current = now;

      hasMarkedSeenRef.current = false;
      // When returning from background, jump to latest message (WhatsApp-like).
      shouldAutoScrollRef.current = true;
      setTimeout(() => {
        fetchMessages(false);
      }, 150);
    });
    return () => sub.remove();
  }, [socket, user?._id, isCalling, callAccepted, fetchMessages]);

  const loadOlderMessages = useCallback(() => {
    if (!hasMoreMessages || loadingMoreMessages || loadingMoreRef.current || messages.length === 0) return;
    const oldest = messages[0];
    const beforeId = oldest?._id?.toString?.() ?? (oldest ? String(oldest._id) : null);
    if (!beforeId) return;
    fetchMessages(true, beforeId);
  }, [hasMoreMessages, loadingMoreMessages, messages, fetchMessages]);

  // Message send timeout (e.g. backend cold start); same as web expectations
  const SEND_MESSAGE_TIMEOUT_MS = 20000;

  const handleSend = async (attempt = 0, clientMsgIdArg?: string) => {
    if (!newMessage.trim() && !pendingMedia) return;

    const isGroupConv = isGroup || groupConversation?.isGroup;
    const groupConvId = isGroupConv ? (toIdString(currentConversationId) || routeConversationIdStr || routeGroupConversationIdStr) : null;
    const recipientIdRaw = isGroupConv ? null : (otherUser?._id ?? userId);
    const recipientId = recipientIdRaw != null ? String(recipientIdRaw) : '';
    if (!isGroupConv && !recipientId.trim()) return;
    if (isGroupConv && !groupConvId) return;

    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
    emitTypingStop();

    const clientMsgId = clientMsgIdArg || `client-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const textSnapshot = newMessage.trim();
    const mediaSnapshot = pendingMedia;
    const replySnapshot = replyingTo;

    if (attempt === 0) {
      const optimistic: any = {
        _id: clientMsgId,
        _clientMsgId: clientMsgId,
        _pending: true,
        text: textSnapshot || (mediaSnapshot ? (mediaSnapshot.type?.startsWith('video') ? '📹' : '📷') : ''),
        sender: {
          _id: user?._id,
          name: user?.name,
          username: user?.username,
          profilePic: user?.profilePic,
        },
        createdAt: new Date().toISOString(),
        seen: false,
        ...(replySnapshot?._id ? { replyTo: replySnapshot } : {}),
        ...(mediaSnapshot?.uri ? { img: mediaSnapshot.uri } : {}),
      };
      setMessages((prev) => {
        const updated = [...prev, optimistic];
        if (updated.length > 200) return updated.slice(-200);
        return updated;
      });
      setNewMessage('');
      setPendingMedia(null);
      setReplyingTo(null);
    }

    setSending(true);
    isSendingRef.current = true;
    shouldAutoScrollRef.current = true;
    try {
      let response: any = null;

      if (mediaSnapshot) {
        const formData = new FormData();
        if (isGroupConv) {
          formData.append('conversationId', String(groupConvId));
        } else {
          formData.append('recipientId', recipientId);
        }
        formData.append('message', textSnapshot);
        if (replySnapshot?._id) {
          formData.append('replyTo', String(replySnapshot._id));
        }

        const uri = mediaSnapshot.uri;
        const name = mediaSnapshot.fileName || `upload_${Date.now()}`;
        const type = mediaSnapshot.type || 'application/octet-stream';

        // @ts-ignore - RN FormData file shape
        formData.append('file', { uri, name, type });

        response = await apiService.upload(ENDPOINTS.SEND_MESSAGE, formData, 'POST', { timeout: SEND_MESSAGE_TIMEOUT_MS });
      } else {
        response = await apiService.post(
          ENDPOINTS.SEND_MESSAGE,
          {
            recipientId: isGroupConv ? undefined : recipientId,
            conversationId: isGroupConv ? String(groupConvId) : undefined,
            message: textSnapshot,
            replyTo: replySnapshot?._id != null ? String(replySnapshot._id) : null,
          },
          { timeout: SEND_MESSAGE_TIMEOUT_MS }
        );
      }

      if (response) {
        const messageWithSender = {
          ...response,
          _pending: false,
          sender: response.sender || {
            _id: user?._id,
            name: user?.name,
            username: user?.username,
            profilePic: user?.profilePic,
          },
        };

        setMessages((prev) => {
          const idx = prev.findIndex((m) => m._clientMsgId === clientMsgId);
          let next: any[];
          if (idx >= 0) {
            next = [...prev];
            next[idx] = messageWithSender;
          } else {
            next = [...prev, messageWithSender];
          }
          if (next.length > 200) return next.slice(-200);
          return next;
        });

        if (!currentConversationId && response.conversationId) {
          setCurrentConversationId(response.conversationId);
        }

        // Inverted list: keep newest visible at offset 0 (bottom)
        setTimeout(() => {
          try {
            (messagesEndRef.current as any)?.scrollToOffset?.({ offset: 0, animated: true });
          } catch (_) {}
        }, 120);
      }
    } catch (error) {
      const maxAttempts = 3;
      if (attempt < maxAttempts - 1) {
        const delayMs = attempt === 0 ? 800 : 1500;
        try {
          await new Promise((r) => setTimeout(r, delayMs));
          await handleSend(attempt + 1, clientMsgId);
          return;
        } catch (_) {}
      }
      console.error('❌ [ChatScreen] handleSend: Error', error);
      setMessages((prev) => prev.filter((m) => m._clientMsgId !== clientMsgId));
      Alert.alert(
        t('error') || 'Error',
        t('messageSendFailed') || 'Message could not be sent. Please try again.'
      );
    } finally {
      setSending(false);
      isSendingRef.current = false;
    }
  };

  const handlePickMedia = async () => {
    try {
      // Opening the native picker can trigger AppState inactive/background on some devices.
      // Avoid reloading messages when coming back from the picker.
      ignoreNextForegroundRefreshRef.current = true;
      const res = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 1,
        quality: 0.8,
        includeBase64: false,
      });
      setTimeout(() => {
        ignoreNextForegroundRefreshRef.current = false;
      }, 600);
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setPendingMedia(asset);
      }
    } catch (e) {
      console.error('❌ [ChatScreen] handlePickMedia error:', e);
      ignoreNextForegroundRefreshRef.current = false;
    }
  };

  const handleRecordVideo = async () => {
    try {
      ignoreNextForegroundRefreshRef.current = true;
      const res = await launchCamera({
        mediaType: 'video',
        videoQuality: 'high',
        durationLimit: 60,
        saveToPhotos: false,
      });
      setTimeout(() => {
        ignoreNextForegroundRefreshRef.current = false;
      }, 600);
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setPendingMedia(asset);
      }
    } catch (e) {
      console.error('❌ [ChatScreen] handleRecordVideo error:', e);
      ignoreNextForegroundRefreshRef.current = false;
    }
  };

  const handleTakePhoto = async () => {
    try {
      ignoreNextForegroundRefreshRef.current = true;
      const res = await launchCamera({
        mediaType: 'photo',
        quality: 0.85,
        saveToPhotos: false,
      });
      setTimeout(() => {
        ignoreNextForegroundRefreshRef.current = false;
      }, 600);
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setPendingMedia(asset);
      }
    } catch (e) {
      console.error('❌ [ChatScreen] handleTakePhoto error:', e);
      ignoreNextForegroundRefreshRef.current = false;
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    try {
      const updated = await apiService.post(`${ENDPOINTS.SEND_MESSAGE}/reaction/${messageId}`, { emoji });
      // Backend returns updated message with populated reactions.userId
      setMessages((prev) =>
        prev.map((m) => {
          if (m._id?.toString?.() !== messageId.toString()) return m;
          return {
            ...m,
            ...updated,
            delivered:
              (updated as any).delivered !== undefined && (updated as any).delivered !== null
                ? (updated as any).delivered
                : m.delivered,
          };
        })
      );
    } catch (e) {
      console.error('❌ [ChatScreen] toggleReaction error:', e);
    } finally {
      setReactionTargetId(null);
      setActionTarget(null);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await apiService.delete(`${ENDPOINTS.SEND_MESSAGE}/message/${messageId}`);
      setMessages((prev) => prev.filter((m) => (m._id?.toString?.() ?? String(m._id)) !== messageId.toString()));
    } catch (e) {
      console.error('❌ [ChatScreen] deleteMessage error:', e);
    } finally {
      setReactionTargetId(null);
      setActionTarget(null);
    }
  };

  const handleCallPress = async (type: 'voice' | 'video') => {
    // Block if partner is already in a call
    if (isPartnerBusy) {
      Alert.alert(t('userBusyTitle') || 'User Busy', t('userBusyMessage') || 'This user is currently in a call.');
      return;
    }

    // CRITICAL: Prevent duplicate calls if already calling or a call is in progress
    // Allow new calls if callEnded is true (previous call finished) OR if callAccepted is false (no active call)
    // Only block if: actively calling OR (call accepted AND call not ended)
    const isCallActive = isCallInProgressRef.current || isCalling || (callAccepted && !callEnded);
    
    if (isCallActive) {
      // FIRM: If only callAccepted is true but we're not calling (user came back from failed/dismissed call),
      // reset WebRTC state once. Do NOT retry from here (setTimeout would close over stale state and cause infinite loop).
      // User can tap Call again after state is cleared.
      if (!isCallInProgressRef.current && !isCalling && callAccepted && !callEnded) {
        leaveCall();
        return;
      }
      return;
    }
    
    // Resolve target user: otherUser can be object, string (id), or null when from list with unpopulated participants
    const targetId = (typeof otherUser === 'string' ? otherUser : otherUser?._id) || userId;
    const targetName = (typeof otherUser === 'object' && otherUser !== null)
      ? (otherUser.name || otherUser.username || 'User')
      : 'User';
    const targetProfilePic = (typeof otherUser === 'object' && otherUser !== null) ? otherUser.profilePic : null;
    if (!targetId) {
      console.warn('⚠️ [ChatScreen] Cannot call - no target user (otherUser/userId missing). Open chat from a conversation with participant info.');
      return;
    }

    isCallInProgressRef.current = true;
    initiatedCallAtRef.current = Date.now();

    try {
      const callType = type === 'voice' ? 'audio' : 'video';
      navigation.navigate('CallScreen', {
        userName: targetName,
        userId: targetId,
        userProfilePic: targetProfilePic,
        callType: callType,
        isOutgoingCall: true,
      });
      setTimeout(async () => {
        try {
          await callUser(targetId, targetName, callType);
        } catch (error: any) {
          console.error('❌ [ChatScreen] Call initiation error:', error?.message);
          isCallInProgressRef.current = false;
          initiatedCallAtRef.current = 0;
          // If callUser failed before isCalling was set, CallScreen won't auto-dismiss — go back manually.
          if (navigation.canGoBack()) navigation.goBack();
        }
      }, 300);
    } catch (error: any) {
      console.error('❌ [ChatScreen] handleCallPress error:', error?.message);
      isCallInProgressRef.current = false;
      initiatedCallAtRef.current = 0;
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const CHAT_EMOJIS = useMemo(
    () => [
      '😂','😍','🥰','😘','😊','😎','🥳','🤯','😢','😭','😡','🤔',
      '👍','👎','👏','🙏','💯','✨','🔥','💥','⚡','🌟','🎉','❤️',
      '🧡','💛','💚','💙','💜','🖤','🤍','💔','💖','🤝','✅','❌',
      '📌','📍','📝','📣','📸','🎥','🎵','⚽','🏆','🎮','🌤️','🌙',
    ],
    []
  );

  const CHAT_MEDIA_SIZE = 220;

  const buildChatVideoHtml = (videoUrl: string) => {
    const optimized = optimizeCloudinaryMediaUrl(videoUrl, 'video');
    const safe = String(optimized).replace(/"/g, '&quot;').replace(/</g, '');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0"/><style>html,body{margin:0;padding:0;width:100%;height:100%;background:#000;overflow:hidden}video{width:100%;height:100%;object-fit:cover;display:block;vertical-align:top}</style></head><body><video controls playsinline preload="metadata" src="${safe}"></video></body></html>`;
  };

  const renderMessage = ({ item }: { item: any }) => {
    const senderId = getSenderId(item.sender);
    const isOwn = senderId === currentUserIdStr;
    // Per your request: sender on LEFT, receiver on RIGHT
    const isSenderLeft = isOwn;
    
    // Get profile picture: for own messages use user.profilePic, for others use sender.profilePic or otherUser.profilePic
    const senderProfilePic = isOwn 
      ? user?.profilePic 
      : (item.sender?.profilePic || otherUser?.profilePic);
    const senderName = isOwn 
      ? (user?.name || user?.username) 
      : (item.sender?.name || item.sender?.username || otherUser?.name || otherUser?.username);

    const outgoingDelivered = isOutgoingDeliveredForTicks(item);

    return (
      <View style={[styles.messageRow, isSenderLeft ? styles.leftRow : styles.rightRow]}>
        {/* Profile picture - on left for sender, on right for receiver */}
        {isSenderLeft ? (
          <View style={styles.messageAvatarContainer}>
            {senderProfilePic ? (
              <Image source={{ uri: senderProfilePic }} style={styles.messageAvatar} />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                <Text style={styles.messageAvatarText}>
                  {senderName?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>
        ) : null}
        
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            // If reaction picker is already showing for this message, dismiss it
            const currentMessageId = item._id?.toString?.() ?? null;
            if (reactionTargetId === currentMessageId) {
              setReactionTargetId(null);
              setActionTarget(null);
            }
          }}
          onLongPress={() => {
            setReactionTargetId(item._id?.toString?.() ?? null);
            setActionTarget(item);
          }}
          style={[
            styles.messageContainer,
            isSenderLeft ? styles.senderMessage : styles.receiverMessage,
            isSenderLeft ? { backgroundColor: WA.outgoingBg } : incomingBubbleStyle,
          ]}
        >
          {item.replyTo && (
            <View
              style={[
                styles.replyPreviewInBubble,
                {
                  backgroundColor: isSenderLeft ? WA.replyBgOwn : incomingReplySurfaceColor,
                  borderLeftColor: isSenderLeft ? WA.replyBarOwn : colors.primary,
                },
              ]}
            >
              <Text
                style={[
                  styles.replyPreviewLabel,
                  { color: isSenderLeft ? WA.outgoingText : incomingMainTextColor },
                ]}
              >
                Reply to {item.replyTo?.sender?.name || item.replyTo?.sender?.username || 'message'}
              </Text>
              <Text
                numberOfLines={2}
                style={[
                  styles.replyPreviewText,
                  {
                    color: isSenderLeft ? WA.metaTimeOwn : theme === 'dark' ? colors.textGray : WA.metaTimeOwn,
                  },
                ]}
              >
                {item.replyTo?.text || (item.replyTo?.img ? '📎 Attachment' : '')}
              </Text>
            </View>
          )}

          {!!item.text && (
            <Text
              style={[
                styles.messageText,
                isSenderLeft ? styles.senderText : styles.receiverText,
                { color: isSenderLeft ? WA.outgoingText : incomingMainTextColor },
              ]}
            >
              {item.text}
            </Text>
          )}

          {!!item.img && !isVideoUrl(item.img) && (
            <Image
              source={{ uri: optimizeCloudinaryMediaUrl(item.img, 'image') }}
              style={styles.chatImage}
              resizeMode="cover"
              onLoadEnd={() => {
                // When an image finishes loading, the content height changes; scroll again.
                if (shouldAutoScrollRef.current) {
                  setTimeout(() => {
                    try {
                      (messagesEndRef.current as any)?.scrollToOffset?.({ offset: 0, animated: true });
                    } catch (_) {}
                  }, 80);
                }
              }}
            />
          )}

          {!!item.img && isVideoUrl(item.img) && (
            <View style={[styles.chatVideoContainer, { width: CHAT_MEDIA_SIZE, height: CHAT_MEDIA_SIZE }]}>
              <WebView
                source={{ html: buildChatVideoHtml(item.img) }}
                style={[styles.chatVideo, { width: CHAT_MEDIA_SIZE, height: CHAT_MEDIA_SIZE }]}
                allowsFullscreenVideo
                mediaPlaybackRequiresUserAction
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
                showsHorizontalScrollIndicator={false}
                androidLayerType="hardware"
              />
            </View>
          )}

          <View
            style={[
              styles.messageMetaRow,
              isSenderLeft ? styles.messageMetaRowOwn : styles.messageMetaRowOther,
            ]}
          >
            <Text
              style={[
                styles.messageTime,
                isSenderLeft ? styles.senderTime : styles.receiverTime,
                { color: isSenderLeft ? WA.metaTimeOwn : colors.textGray },
              ]}
            >
              {formatTime(item.createdAt)}
            </Text>
            {isSenderLeft ? (
              <Text
                style={[
                  styles.deliveryTicks,
                  item.seen === true ? { color: WA.tickRead } : { color: WA.tickUnseen },
                ]}
                accessibilityLabel={
                  item._pending
                    ? 'Sending'
                    : item.seen === true
                      ? 'Read'
                      : outgoingDelivered
                        ? 'Delivered'
                        : 'Sent'
                }
              >
                {item._pending || (item.seen !== true && !outgoingDelivered) ? '✓' : '✓✓'}
              </Text>
            ) : null}
          </View>

          {/* Reactions (simple display) */}
          {Array.isArray(item.reactions) && item.reactions.length > 0 && (
            <View style={styles.reactionsRow}>
              {item.reactions.slice(0, 6).map((r: any, idx: number) => (
                <Text key={`${item._id}-r-${idx}`} style={styles.reactionEmoji}>{r.emoji}</Text>
              ))}
            </View>
          )}
        </TouchableOpacity>
        
        {/* Profile picture - on right for receiver */}
        {!isSenderLeft ? (
          <View style={styles.messageAvatarContainer}>
            {senderProfilePic ? (
              <Image source={{ uri: senderProfilePic }} style={styles.messageAvatar} />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                <Text style={styles.messageAvatarText}>
                  {senderName?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const Wrapper: any = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const wrapperProps =
    Platform.OS === 'ios'
      ? { behavior: 'padding' as const, keyboardVerticalOffset: 90 }
      : {};

  return (
    <Wrapper style={[styles.container, { backgroundColor: colors.background }]} {...wrapperProps}>
      <View style={[styles.header, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backButton, { color: colors.text }]}>←</Text>
        </TouchableOpacity>

        {(isGroup || groupConversation?.isGroup) ? (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: '#1a4a8a' }]}>
            <Text style={[styles.avatarText, { fontSize: 20 }]}>👥</Text>
          </View>
        ) : otherUser?.profilePic ? (
          <Image source={{ uri: otherUser.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
            <Text style={styles.avatarText}>
              {otherUser?.name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={styles.headerInfo}
          onPress={() => {
            if (isGroup || groupConversation?.isGroup) {
              navigation.navigate('GroupInfo', {
                conversation: groupConversation || { _id: conversationId, groupName, isGroup: true, participants: [] },
              });
            }
          }}
          activeOpacity={(isGroup || groupConversation?.isGroup) ? 0.7 : 1}
        >
          <View style={styles.headerTitleRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {(isGroup || groupConversation?.isGroup) ? (groupName || groupConversation?.groupName || 'Group') : (otherUser?.name || 'User')}
            </Text>
            {!(isGroup || groupConversation?.isGroup) && isPartnerBusy && (
              <View style={[styles.headerOnlineDot, { backgroundColor: '#E53E3E', marginLeft: 4 }]} />
            )}
            {!(isGroup || groupConversation?.isGroup) && !isPartnerBusy && isPartnerOnline && (
              <View style={[styles.headerOnlineDot, { backgroundColor: colors.success }]} />
            )}
          </View>
          <Text style={[styles.headerSubtitle, { color: isPartnerBusy ? '#E53E3E' : colors.textGray }]} numberOfLines={1}>
            {(isGroup || groupConversation?.isGroup)
              ? `${groupConversation?.participants?.length || '...'} members · tap for info`
              : isPartnerBusy
                ? (t('inACall') || 'In a call')
                : (isPartnerOnline ? t('online') : t('offline'))}
          </Text>
        </TouchableOpacity>

        {/* Call Buttons (1-to-1 only) */}
        {!(isGroup || groupConversation?.isGroup) && (
          <>
            <TouchableOpacity onPress={() => handleCallPress('voice')} style={styles.callButton}>
              <Text style={styles.callIcon}>📞</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleCallPress('video')} style={styles.callButton}>
              <Text style={styles.callIcon}>📹</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <FlatList
        ref={messagesEndRef}
        inverted
        // Backend returns chronological (oldest -> newest). For inverted lists we feed newest-first
        // so the newest message sticks to the bottom (WhatsApp-like).
        data={[...messages].reverse()}
        extraData={messages.length}
        renderItem={renderMessage}
        keyExtractor={(item, index) => item._id || index.toString()}
        contentContainerStyle={styles.messagesList}
        maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
        // With inverted lists, `onEndReached` is the natural "load older" trigger.
        onEndReached={() => {
          if (hasMoreMessages && !loadingMoreMessages && messages.length > 0) {
            loadOlderMessages();
          }
        }}
        onEndReachedThreshold={0.2}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          shouldAutoScrollRef.current = false;
        }}
        onScroll={(e) => {
          // With inverted lists, being "at the bottom" means contentOffset.y is near 0.
          const y = e?.nativeEvent?.contentOffset?.y ?? 0;
          lastScrollOffsetRef.current = y;
          shouldAutoScrollRef.current = y < 80;
        }}
        ListHeaderComponent={
          loadingMoreMessages ? (
            <View style={styles.loadMoreIndicator}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : null
        }
      />

      {isPartnerTyping ? (
        <View
          style={[
            styles.typingRow,
            { borderTopColor: colors.border, backgroundColor: colors.background },
          ]}
        >
          <Text style={[styles.typingText, { color: colors.textGray }]}>
            {otherUser?.name
              ? `${(otherUser.name as string).split(/\s+/)[0]} `
              : ''}
            {t('typing')}…
          </Text>
        </View>
      ) : null}

      {/* Reaction picker (minimal) */}
      {reactionTargetId && actionTarget && (
        <View style={[styles.reactionPicker, { backgroundColor: colors.backgroundLight, borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => {
              setReplyingTo(actionTarget);
              setReactionTargetId(null);
              setActionTarget(null);
            }}
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.actionBtnText}>{t('reply')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleDeleteMessage(actionTarget._id)}
            style={[styles.actionBtn, { backgroundColor: colors.error }]}
          >
            <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>{t('delete')}</Text>
          </TouchableOpacity>

          <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.reactionEmojiRow}>
            {[
              '👍','👎','❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💖',
              '😂','🤣','😍','🥰','😘','😊','😎','🤯','😮','😢','😭','😡','🤔',
              '🔥','💥','⚡','✨','🌟','🎉','🥳','👏','🙏','🤝','✅','❌',
              '⚽','🏆','🎮','🎥','🎵','📌','📍','📝','📣','📸','🌤️','🌙',
            ].map((e) => (
              <TouchableOpacity key={e} onPress={() => handleToggleReaction(reactionTargetId, e)} style={styles.reactionPickBtn}>
                <Text style={styles.reactionPickEmoji}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
          <TouchableOpacity onPress={() => { setReactionTargetId(null); setActionTarget(null); }} style={styles.reactionPickBtn}>
            <Text style={styles.reactionPickEmoji}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {replyingTo && (
        <View style={[styles.replyBanner, { backgroundColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.replyBannerTitle, { color: colors.text }]}>
              {t('replyingTo')} {replyingTo?.sender?.name || replyingTo?.sender?.username || t('message')}
            </Text>
            <Text numberOfLines={1} style={[styles.replyBannerText, { color: colors.textGray }]}>
              {replyingTo?.text || (replyingTo?.img ? t('attachment') : '')}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingTo(null)}>
            <Text style={[styles.replyBannerClose, { color: colors.text }]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Media preview */}
      {pendingMedia?.uri ? (
        <View style={[styles.mediaPreview, { backgroundColor: colors.border }]}>
          <Text style={[styles.mediaPreviewText, { color: colors.text }]}>
            {pendingMedia.type?.startsWith('video') ? t('videoSelected') : t('imageSelected')}
          </Text>
          <TouchableOpacity onPress={() => setPendingMedia(null)}>
            <Text style={[styles.mediaRemove, { color: colors.error }]}>{t('remove')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {emojiOpen && (
        <View style={[styles.emojiComposer, { backgroundColor: colors.backgroundLight, borderTopColor: colors.border }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.emojiComposerRow}>
            {CHAT_EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                onPress={() => setNewMessage((prev) => `${prev}${e}`)}
                style={styles.emojiComposerBtn}
                activeOpacity={0.8}
              >
                <Text style={styles.emojiComposerEmoji}>{e}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      <View style={[styles.inputContainer, { backgroundColor: colors.backgroundLight, borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={() => setAttachOpen((v) => !v)} style={[styles.attachBtn, { backgroundColor: colors.border }]}>
          <Text style={[styles.attachIcon, { color: colors.text }]}>＋</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setEmojiOpen((v) => !v)}
          style={[styles.attachBtn, { backgroundColor: colors.border }]}
          activeOpacity={0.85}
        >
          <Text style={[styles.attachIcon, { color: colors.text }]}>😊</Text>
        </TouchableOpacity>
        <TextInput
          style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
          placeholder={t('typeMessage')}
          placeholderTextColor={colors.textGray}
          value={newMessage}
          onChangeText={handleMessageTextChange}
          multiline
          onFocus={() => {
            setEmojiOpen(false);
            // Inverted list: keep latest message visible when keyboard opens.
            // Offset 0 is the "bottom" (newest) for inverted FlatList.
            shouldAutoScrollRef.current = true;
            requestAnimationFrame(() => {
              try {
                (messagesEndRef.current as any)?.scrollToOffset?.({ offset: 0, animated: false });
              } catch (_) {}
            });
            // When keyboard opens, ensure input and latest message are visible
            shouldAutoScrollRef.current = true;
            setTimeout(() => {
              try {
                (messagesEndRef.current as any)?.scrollToOffset?.({ offset: 0, animated: false });
              } catch (_) {}
            }, 120);
          }}
        />
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: colors.primary }, sending && styles.sendButtonDisabled]}
          onPress={() => handleSend()}
          disabled={sending || (!newMessage.trim() && !pendingMedia)}
        >
          {sending ? (
            <ActivityIndicator color={colors.buttonText} />
          ) : (
            <Text style={[styles.sendButtonText, { color: colors.buttonText }]}>➤</Text>
          )}
        </TouchableOpacity>
      </View>

      {attachOpen && (
        <View style={[styles.attachMenu, { backgroundColor: colors.backgroundLight, borderTopColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.attachMenuBtn, { borderColor: colors.border }]}
            onPress={() => {
              setAttachOpen(false);
              handlePickMedia();
            }}
            activeOpacity={0.85}
          >
            <Text style={[styles.attachMenuText, { color: colors.text }]}>🖼️ {t('pickPhotoVideo')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachMenuBtn, { borderColor: colors.border }]}
            onPress={() => {
              setAttachOpen(false);
              handleTakePhoto();
            }}
            activeOpacity={0.85}
          >
            <Text style={[styles.attachMenuText, { color: colors.text }]}>📸 {t('takePhoto')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachMenuBtn, { borderColor: colors.border }]}
            onPress={() => {
              setAttachOpen(false);
              handleRecordVideo();
            }}
            activeOpacity={0.85}
          >
            <Text style={[styles.attachMenuText, { color: colors.text }]}>🎥 {t('recordVideo')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.attachMenuBtn, { borderColor: 'transparent' }]}
            onPress={() => setAttachOpen(false)}
            activeOpacity={0.85}
          >
            <Text style={[styles.attachMenuText, { color: colors.textGray }]}>{t('cancel')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadMoreIndicator: {
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    fontSize: 24,
    color: COLORS.text,
    marginRight: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  headerSubtitle: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'left',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerOnlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
  },
  callButton: {
    marginLeft: 15,
  },
  callIcon: {
    fontSize: 24,
  },
  messagesList: {
    padding: 15,
  },
  messageRow: {
    width: '100%',
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  leftRow: {
    justifyContent: 'flex-start',
  },
  rightRow: {
    justifyContent: 'flex-end',
  },
  messageAvatarContainer: {
    marginHorizontal: 8,
    marginBottom: 4,
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  messageAvatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  messageContainer: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 12,
    backgroundColor: WA.incomingBg,
  },
  senderMessage: {
    backgroundColor: WA.outgoingBg,
  },
  receiverMessage: {
    backgroundColor: WA.incomingBg,
  },
  messageText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 4,
  },
  senderText: {
    color: WA.outgoingText,
  },
  receiverText: {
    color: COLORS.text,
  },
  messageMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 4,
    alignSelf: 'flex-end',
  },
  messageMetaRowOwn: {
    alignSelf: 'flex-end',
  },
  messageMetaRowOther: {
    alignSelf: 'flex-end',
  },
  deliveryTicks: {
    fontSize: 13,
    marginLeft: 6,
    letterSpacing: -3,
    fontWeight: '600',
  },
  messageTime: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  senderTime: {
    color: WA.metaTimeOwn,
  },
  receiverTime: {
    color: COLORS.textGray,
  },
  chatImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginTop: 8,
  },
  chatVideoContainer: {
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    backgroundColor: '#000',
  },
  chatVideo: {
    backgroundColor: '#000',
  },
  reactionsRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundLight,
    marginRight: 8,
  },
  actionBtnText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  actionDivider: {
    width: 1,
    height: 24,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  replyBannerTitle: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  replyBannerText: {
    fontSize: 12,
    color: COLORS.textGray,
    marginTop: 2,
  },
  replyBannerClose: {
    fontSize: 16,
    color: COLORS.textGray,
    marginLeft: 12,
    padding: 6,
  },
  replyPreviewInBubble: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    marginBottom: 6,
    borderRadius: 4,
  },
  replyPreviewLabel: {
    fontSize: 11,
    fontWeight: 'bold',
  },
  replyPreviewText: {
    fontSize: 11,
    marginTop: 2,
  },
  reactionPickBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  reactionPickEmoji: {
    fontSize: 18,
  },
  reactionEmojiRow: {
    alignItems: 'center',
    paddingRight: 6,
  },
  mediaPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  emojiComposer: {
    borderTopWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: COLORS.backgroundLight,
  },
  emojiComposerRow: {
    paddingRight: 6,
  },
  emojiComposerBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  emojiComposerEmoji: {
    fontSize: 20,
  },
  attachMenu: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: COLORS.backgroundLight,
  },
  attachMenuBtn: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  attachMenuText: {
    fontSize: 15,
    fontWeight: '700',
  },
  mediaPreviewText: {
    color: COLORS.textGray,
    fontSize: 13,
  },
  mediaRemove: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  typingRow: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  typingText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'flex-end',
  },
  attachBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    backgroundColor: COLORS.backgroundLight,
  },
  attachIcon: {
    fontSize: 20,
    color: COLORS.text,
    lineHeight: 20,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 6,
    color: COLORS.text,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    width: 44,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 18,
  },
});

export default ChatScreen;
