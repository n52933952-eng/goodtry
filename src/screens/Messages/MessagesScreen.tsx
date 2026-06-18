import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  TextInput,
  Alert,
  AppState,
  DeviceEventEmitter,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS, STORY_STRIP_SHOULD_REFRESH } from '../../utils/constants';
import { useLanguage } from '../../context/LanguageContext';
import StoryAvatarRing from '../../components/StoryAvatarRing';
import StoryOrProfileSheet from '../../components/StoryOrProfileSheet';
import ConversationListItem from './ConversationListItem';
import { navigateToMainStack } from '../../utils/navigationHelpers';
import { liveSharePreviewText } from '../../utils/liveShareMessage';

const LIST_AVATAR = 50;
const LIST_RING_OUTER = 56;
const LIST_RING_STROKE = 2;
const CONVERSATIONS_PAGE_SIZE = 8;

const conversationIdKey = (conversation: any): string =>
  conversation?._id?.toString?.() ?? String(conversation?._id ?? '');

/** Refresh first page without dropping conversations the user already scrolled to load. */
const mergeConversationRefresh = (existing: any[], freshPage: any[]): any[] => {
  if (!existing.length) return freshPage;
  if (!freshPage.length) return existing;
  const freshIds = new Set(freshPage.map(conversationIdKey));
  const tail = existing.filter((c) => !freshIds.has(conversationIdKey(c)));
  return [...freshPage, ...tail];
};

/** Keep list titles/previews left-aligned next to the avatar even for Arabic/RTL scripts. */
const LTR_TEXT = {
  textAlign: 'left' as const,
  writingDirection: 'ltr' as const,
};

const toIdString = (value: any): string => {
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
};

const MessagesScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const { socket, selectedConversationId, setPresenceWatchUserIds, isUserOnline, refreshPresenceSubscription } = useSocket();
  const { colors } = useTheme();
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const isFetchingConversationsRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchConversationResults, setSearchConversationResults] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchRequestIdRef = useRef(0);
  const [followingUsers, setFollowingUsers] = useState<any[]>([]);
  const isFirstLoadRef = useRef(true);
  /** userId -> story ring (same source as feed post avatars) */
  const [storyByUserId, setStoryByUserId] = useState<
    Record<string, { storyId: string; hasUnviewed: boolean }>
  >({});
  const [storyRingReplayKey, setStoryRingReplayKey] = useState(0);
  const [storySheet, setStorySheet] = useState<{ userId: string; username: string } | null>(null);
  
  // Track selected conversation with ref (like web version)
  const selectedConversationIdRef = useRef<string | null>(null);
  
  // Ref to fetchConversations function so it can be called from handleNewMessage
  const fetchConversationsRef = useRef<any>(null);
  /** Throttle expensive aux work when bouncing Messages ↔ Chat ↔ other tabs (conversations still refresh every focus). */
  const lastFollowingFetchAtRef = useRef(0);
  const lastPresenceRefreshAtRef = useRef(0);
  const FOLLOWING_REFETCH_FOCUS_MIN_MS = 45_000;
  const PRESENCE_REFRESH_FOCUS_MIN_MS = 12_000;
  /** Skip redundant list+story API when bouncing Messages ↔ Chat (socket still updates rows). */
  const lastConvListAndStoryFetchAtRef = useRef(0);
  const CONV_LIST_STORY_FOCUS_MIN_MS = 30_000;
  /** Promote opened chat to top on return without waiting for a full list refetch. */
  const lastOpenedConversationIdRef = useRef<string | null>(null);
  /** Avoid re-sending the same presence watch set when `conversations` gets a new array reference with the same partners. */
  const lastPresenceWatchKeyRef = useRef('');
  const convCursorRef = useRef<string | null>(null);

  useEffect(() => {
    lastFollowingFetchAtRef.current = 0;
    lastPresenceRefreshAtRef.current = 0;
    lastConvListAndStoryFetchAtRef.current = 0;
    lastPresenceWatchKeyRef.current = '';
  }, [user?._id]);

  // Update selectedConversationId ref whenever it changes
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId || null;
  }, [selectedConversationId]);

  // Handle new messages - STABLE FUNCTION (like web version)
  const handleNewMessage = React.useCallback((messageData: any) => {
    setConversations((prevConvos) => {
      const conversationId = messageData.conversationId?.toString();
      if (!conversationId) return prevConvos;

      // Get sender ID (handle both populated object and ID string)
      const senderId = messageData.sender?._id?.toString() || messageData.sender?.toString() || messageData.sender;
      const isOwnMessage = senderId === user?._id?.toString();
      // Use REF instead of closure variable (like web version)
      const isConversationOpen =
        !!selectedConversationIdRef.current &&
        selectedConversationIdRef.current.toString() === conversationId.toString();

      // Check if conversation already exists
      const existingIndex = prevConvos.findIndex(
        (conv) => conv._id?.toString() === conversationId
      );

      if (existingIndex >= 0) {
        // Update existing conversation
        const lastMessageText =
          liveSharePreviewText(messageData.text)
          || messageData.text
          || (messageData.img ? '📷 Image' : '');
        
        const updatedConversation = {
          ...prevConvos[existingIndex],
          lastMessage: {
            text: lastMessageText,
            createdAt: messageData.createdAt,
            sender: messageData.sender,
          },
          updatedAt: messageData.conversationUpdatedAt || messageData.createdAt || new Date(),
          // Only increment unread count if message is from other user
          // And only if this conversation isn't currently open
          unreadCount: (!isOwnMessage && !isConversationOpen)
            ? ((prevConvos[existingIndex].unreadCount || 0) + 1)
            : (isConversationOpen ? 0 : (prevConvos[existingIndex].unreadCount || 0)),
        };

        // If this conversation is currently open in Chat, keep its position (no visual jump).
        if (isConversationOpen) {
          const updated = [...prevConvos];
          updated[existingIndex] = updatedConversation;
          return updated;
        }

        // Otherwise move to top WITHOUT full re-sort (new message => most recent)
        return [updatedConversation, ...prevConvos.filter((_, i) => i !== existingIndex)];
      } else {
        // New conversation - fetch it from API to get full conversation data
        if (fetchConversationsRef.current) {
          fetchConversationsRef.current(false, { silent: true });
        }
        return prevConvos;
      }
    });
  }, [user?._id]);

  const handleUnreadCountUpdate = React.useCallback((_data: any) => {
    // Optionally update total unread count if needed
  }, []);

  /** Live ended — refresh list so "🔴 is live" preview disappears (cards already purged on server). */
  const handleLiveShareCleanup = React.useCallback(() => {
    fetchConversationsRef.current?.(false, { silent: true });
  }, []);

  /** DM removed (e.g. unfollow) — drop from list without waiting for refetch. */
  const handleConversationDeleted = React.useCallback((data: any) => {
    const conversationId = data?.conversationId?.toString();
    if (!conversationId) return;
    setConversations((prev) =>
      prev.filter((conv) => conv._id?.toString() !== conversationId),
    );
  }, []);

  const handleMessagesSeen = React.useCallback((data: any) => {
    const conversationId = data.conversationId?.toString();
    if (!conversationId) return;

    // Prevent infinite loop: only update if unreadCount is actually > 0
    setConversations((prevConvos) => {
      const existingIndex = prevConvos.findIndex(
        (conv) => conv._id?.toString() === conversationId
      );
      
      // Only update if conversation exists and has unread messages
      if (existingIndex >= 0 && (prevConvos[existingIndex].unreadCount || 0) > 0) {
        const updated = [...prevConvos];
        updated[existingIndex] = {
          ...updated[existingIndex],
          unreadCount: 0,
        };
        return updated;
      }
      
      // No change needed, return same array reference to prevent re-render
      return prevConvos;
    });
  }, []);

  // Re-bind after every new Socket.IO instance: connect() replaces the client and drops old listeners,
  // but this effect’s deps don’t change — without this, list only updates after focus refetch.
  useEffect(() => {
    if (!socket || !user?._id) return;

    const bindConversationListeners = () => {
      if (!socket.getSocket?.()) return;
      socket.off('newMessage', handleNewMessage);
      socket.off('unreadCountUpdate', handleUnreadCountUpdate);
      socket.off('conversationMarkedRead', handleMessagesSeen);
      socket.off('liveShareExpired', handleLiveShareCleanup);
      socket.off('livekit:streamEnded', handleLiveShareCleanup);
      socket.off('conversationDeleted', handleConversationDeleted);
      socket.on('newMessage', handleNewMessage);
      socket.on('unreadCountUpdate', handleUnreadCountUpdate);
      socket.on('conversationMarkedRead', handleMessagesSeen);
      socket.on('liveShareExpired', handleLiveShareCleanup);
      socket.on('livekit:streamEnded', handleLiveShareCleanup);
      socket.on('conversationDeleted', handleConversationDeleted);
    };

    bindConversationListeners();
    const removeSocketReady = socket.addSocketReadyListener(bindConversationListeners);
    const removeConnect = socket.addConnectListener(bindConversationListeners);

    return () => {
      removeSocketReady();
      removeConnect();
      socket.off('newMessage', handleNewMessage);
      socket.off('unreadCountUpdate', handleUnreadCountUpdate);
      socket.off('conversationMarkedRead', handleMessagesSeen);
      socket.off('liveShareExpired', handleLiveShareCleanup);
      socket.off('livekit:streamEnded', handleLiveShareCleanup);
      socket.off('conversationDeleted', handleConversationDeleted);
    };
  }, [socket, user?._id, handleNewMessage, handleUnreadCountUpdate, handleMessagesSeen, handleLiveShareCleanup, handleConversationDeleted]);

  const fetchStoryStrip = useCallback(async () => {
    if (!user?._id) return;
    try {
      const data = await apiService.get(ENDPOINTS.STORY_FEED_STRIP);
      const m: Record<string, { storyId: string; hasUnviewed: boolean }> = {};
      for (const s of data.stories || []) {
        const uid = s.user?._id?.toString?.();
        if (uid && s.storyId) {
          m[uid] = { storyId: String(s.storyId), hasUnviewed: !!s.hasUnviewed };
        }
      }
      setStoryByUserId(m);
    } catch (_) {
      /* optional */
    }
  }, [user?._id]);

  useEffect(() => {
    fetchStoryStrip();
  }, [fetchStoryStrip]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(STORY_STRIP_SHOULD_REFRESH, () => {
      setStoryRingReplayKey((k) => k + 1);
      fetchStoryStrip();
    });
    return () => sub.remove();
  }, [fetchStoryStrip]);

  // Refresh conversations and following users when screen comes into focus 
  // (e.g., when returning from ChatScreen or after following a new user)
  useFocusEffect(
    React.useCallback(() => {
      const first = isFirstLoadRef.current;
      if (first) isFirstLoadRef.current = false;

      const now = Date.now();
      const listStale =
        first || now - lastConvListAndStoryFetchAtRef.current >= CONV_LIST_STORY_FOCUS_MIN_MS;
      if (listStale) {
        lastConvListAndStoryFetchAtRef.current = now;
        fetchStoryStrip();
        fetchConversations(false, { silent: !first });
      } else {
        const openedId = lastOpenedConversationIdRef.current?.toString();
        if (openedId) {
          setConversations((prev) => {
            const idx = prev.findIndex((c) => c._id?.toString() === openedId);
            if (idx <= 0) return prev;
            const conv = prev[idx];
            return [conv, ...prev.filter((_, i) => i !== idx)];
          });
        }
      }
      lastOpenedConversationIdRef.current = null;

      if (now - lastFollowingFetchAtRef.current >= FOLLOWING_REFETCH_FOCUS_MIN_MS) {
        lastFollowingFetchAtRef.current = now;
        fetchFollowingUsers();
      }
      if (now - lastPresenceRefreshAtRef.current >= PRESENCE_REFRESH_FOCUS_MIN_MS) {
        lastPresenceRefreshAtRef.current = now;
        refreshPresenceSubscription();
      }
    }, [refreshPresenceSubscription, fetchStoryStrip])
  );

  const fetchConversations = async (
    loadMore = false,
    opts: { silent?: boolean } = {}
  ) => {
    // Prevent duplicate requests (but allow the very first fetch even if loading=true initially)
    if (isFetchingConversationsRef.current) return;
    if (loadMore && (loadingMoreConversations || !hasMoreConversations)) return;
    if (loadMore && !convCursorRef.current) return;

    if (loadMore) {
      setLoadingMoreConversations(true);
    } else {
      // Only reset pagination cursor on a true first load — keep cursor after user scrolled.
      if (conversations.length === 0) {
        convCursorRef.current = null;
      }
      const shouldShowSpinner = !opts.silent && conversations.length === 0;
      if (shouldShowSpinner) setLoading(true);
    }

    try {
      isFetchingConversationsRef.current = true;
      let url = `${ENDPOINTS.GET_CONVERSATIONS}?limit=${CONVERSATIONS_PAGE_SIZE}`;
      if (loadMore && convCursorRef.current) {
        url += `&cursor=${encodeURIComponent(convCursorRef.current)}`;
      }

      const data = await apiService.get(url);

      const convos = data?.conversations || data || [];
      const hasMore = data?.hasMore === true;

      if (loadMore) {
        if (data?.nextCursor != null && String(data.nextCursor).trim() !== '') {
          convCursorRef.current = String(data.nextCursor);
        } else {
          convCursorRef.current = null;
        }
        setHasMoreConversations(hasMore);
        setConversations((prev) => {
          const map = new Map<string, any>();
          prev.forEach((c) => map.set(conversationIdKey(c), c));
          convos.forEach((c: any) => map.set(conversationIdKey(c), c));
          return Array.from(map.values());
        });
      } else if (conversations.length === 0) {
        if (data?.nextCursor != null && String(data.nextCursor).trim() !== '') {
          convCursorRef.current = String(data.nextCursor);
        } else {
          convCursorRef.current = null;
        }
        setHasMoreConversations(hasMore);
        setConversations(convos);
      } else {
        // Smart refresh: update top page + keep older loaded rows and load-more cursor.
        setHasMoreConversations(hasMore || !!convCursorRef.current);
        setConversations((prev) => mergeConversationRefresh(prev, convos));
      }
    } catch (error: any) {
      console.error('❌ [MessagesScreen] fetchConversations: Error', error);
      if (!loadMore) {
        setConversations((prev) => (prev.length > 0 ? prev : []));
      }
    } finally {
      isFetchingConversationsRef.current = false;
      setLoading(false);
      setLoadingMoreConversations(false);
    }
  };
  
  // Assign fetchConversations to ref so handleNewMessage can use it
  useEffect(() => {
    fetchConversationsRef.current = fetchConversations;
  }, [fetchConversations]);

  // When returning from background, refresh conversations (push may arrive while offline/reconnecting).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      fetchConversationsRef.current?.(false, { silent: true });
    });
    return () => sub.remove();
  }, []);

  // Watch presence for all loaded 1:1 conversations (reliable online dots on the list).
  useEffect(() => {
    if (!user?._id) {
      lastPresenceWatchKeyRef.current = '';
      setPresenceWatchUserIds([]);
      return;
    }

    const myId = user._id?.toString?.() ?? String(user._id);
    const partnerIds = conversations
      .filter((conversation: any) => !conversation?.isGroup)
      .map((conversation: any) => {
        const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
        const other = participants.find((p: any) => {
          const pid = p?._id?.toString?.() ?? p?.toString?.() ?? String(p);
          return pid && pid !== myId;
        });
        return other?._id?.toString?.() ?? other?.toString?.() ?? (other != null ? String(other) : '');
      })
      .filter((id: string) => !!id);

    const watchKey = partnerIds.slice().sort().join('|');
    if (watchKey === lastPresenceWatchKeyRef.current) return;
    lastPresenceWatchKeyRef.current = watchKey;

    setPresenceWatchUserIds(partnerIds);
  }, [conversations, user?._id, setPresenceWatchUserIds]);

  // Foreground FCM "message" should not pop an Alert; we refresh the list instead.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('MessageFromFCM', () => {
      fetchConversationsRef.current?.(false, { silent: true });
    });
    return () => sub.remove();
  }, []);

  const fetchFollowingUsers = async () => {
    if (!user?._id) {
      return;
    }

    try {
      // Scalable: backend already provides a dedicated endpoint returning user objects (limited to 30)
      const data = await apiService.get(ENDPOINTS.GET_FOLLOWING_USERS);
      const users = Array.isArray(data) ? data : (data?.users || []);

      setFollowingUsers(users);
    } catch (error: any) {
      console.error('❌ [MessagesScreen] fetchFollowingUsers: Error:', error);
      setFollowingUsers([]);
    }
  };

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSearch = (query: string) => {
    setSearchQuery(query);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    if (!query.trim()) {
      setSearchConversationResults([]);
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      const requestId = ++searchRequestIdRef.current;
      const q = query.trim();
      const searchTerm = q.toLowerCase();

      try {
        const data = await apiService.get(
          `${ENDPOINTS.SEARCH_CONVERSATIONS}?q=${encodeURIComponent(q)}&limit=20`,
        );
        if (requestId !== searchRequestIdRef.current) return;

        const convos = data?.conversations || [];
        setSearchConversationResults(convos);

        const existingPartnerIds = new Set<string>();
        for (const conv of convos) {
          if (conv?.isGroup) continue;
          const other = conv?.participants?.[0];
          const pid = other?._id?.toString?.() ?? (other != null ? String(other) : '');
          if (pid) existingPartnerIds.add(pid);
        }

        const filtered = followingUsers.filter((u: any) => {
          const uid = u._id?.toString?.() ?? String(u._id);
          if (existingPartnerIds.has(uid)) return false;
          const name = (u.name || '').toLowerCase();
          const username = (u.username || '').toLowerCase();
          return name.includes(searchTerm) || username.includes(searchTerm);
        });

        setSearchResults(filtered);
      } catch (error: any) {
        if (requestId !== searchRequestIdRef.current) return;
        console.error('❌ [MessagesScreen] handleSearch: Error:', error);
        setSearchConversationResults([]);
        setSearchResults([]);
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setSearching(false);
        }
      }
    }, 300);
  };

  const handleStartConversation = async (selectedUser: any) => {
    try {
      // Check if a 1-to-1 conversation already exists (exclude groups — a group can
      // contain the searched user but is not a direct chat with them)
      const existingConvo = conversations.find((conv: any) => {
        if (conv.isGroup) return false;
        const otherUser = getOtherUser(conv);
        const otherUserId = typeof otherUser === 'string' ? otherUser : otherUser?._id;
        return String(otherUserId) === String(selectedUser._id);
      });

      if (existingConvo) {
        lastOpenedConversationIdRef.current = existingConvo._id?.toString?.() ?? String(existingConvo._id);
        // Navigate to existing conversation
        navigation.navigate('ChatScreen', {
          conversationId: existingConvo._id,
          otherUser: selectedUser,
        });
      } else {
        // Create new conversation by sending first message (backend will create conversation)
        // Navigate to ChatScreen with userId, backend will handle conversation creation
        navigation.navigate('ChatScreen', {
          userId: selectedUser._id,
          otherUser: selectedUser,
        });
      }
      
      // Clear search
      setSearchQuery('');
      setSearchConversationResults([]);
      setSearchResults([]);
    } catch (error: any) {
      console.error('Error starting conversation:', error);
    }
  };

  const getOtherUser = useCallback((conversation: any) => {
    if (!conversation.participants || !user) return null;
    return conversation.participants.find((p: any) => {
      const pId = typeof p === 'string' ? p : p._id;
      return pId !== user._id;
    });
  }, [user?._id]);

  const onMessagingAvatarPress = useCallback(
    (
      userId: string | undefined,
      userObj: { username?: string; name?: string } | null | undefined,
    ) => {
      const uid = userId?.toString();
      if (!uid) return;
      const ring = storyByUserId[uid];
      const username = (userObj?.username || '').trim();
      if (ring?.storyId) {
        setStorySheet({ userId: uid, username });
        return;
      }
      if (username) {
        navigation.navigate('Profile', {
          screen: 'UserProfile',
          params: { username },
        });
      }
    },
    [navigation, storyByUserId, t],
  );

  const handleGroupCreated = React.useCallback((conv: any) => {
    setConversations((prev) => {
      if (prev.some((c) => c._id?.toString() === conv._id?.toString())) return prev;
      return [conv, ...prev];
    });
  }, []);

  const handleGroupMemberLeft = React.useCallback((data: any) => {
    const myId = user?._id?.toString();
    if (data?.userId?.toString() === myId) {
      setConversations((prev) => prev.filter((c) => c._id?.toString() !== data.conversationId?.toString()));
    }
  }, [user?._id]);

  const handleRemovedFromGroup = React.useCallback((data: any) => {
    setConversations((prev) => prev.filter((c) => c._id?.toString() !== data.conversationId?.toString()));
  }, []);

  // Bind group socket events
  useEffect(() => {
    if (!socket || !user?._id) return;
    const bind = () => {
      socket.off('groupCreated', handleGroupCreated);
      socket.off('groupMemberLeft', handleGroupMemberLeft);
      socket.off('removedFromGroup', handleRemovedFromGroup);
      socket.on('groupCreated', handleGroupCreated);
      socket.on('groupMemberLeft', handleGroupMemberLeft);
      socket.on('removedFromGroup', handleRemovedFromGroup);
    };
    bind();
    const r1 = socket.addSocketReadyListener?.(bind);
    const r2 = socket.addConnectListener?.(bind);
    return () => {
      r1?.(); r2?.();
      socket.off('groupCreated', handleGroupCreated);
      socket.off('groupMemberLeft', handleGroupMemberLeft);
      socket.off('removedFromGroup', handleRemovedFromGroup);
    };
  }, [socket, user?._id, handleGroupCreated, handleGroupMemberLeft, handleRemovedFromGroup]);

  const handleOpenConversation = useCallback(
    (item: any) => {
      const isGroupConv = !!item.isGroup;
      const otherUser = isGroupConv ? null : getOtherUser(item);
      const otherUserData = !isGroupConv && otherUser && typeof otherUser !== 'string' ? otherUser : null;
      const convId = toIdString(item._id);
      lastOpenedConversationIdRef.current = convId || null;
      navigation.navigate('ChatScreen', {
        conversationId: convId,
        otherUser: isGroupConv ? null : otherUserData,
        isGroup: isGroupConv,
        groupName: isGroupConv ? item.groupName : undefined,
        conversation: item,
      });
    },
    [navigation, getOtherUser],
  );

  const handleConversationRemoved = useCallback((conversationId: string) => {
    setConversations((prev) =>
      prev.filter((c) => (c._id?.toString?.() ?? String(c._id)) !== conversationId),
    );
  }, []);

  const renderConversation = useCallback(
    ({ item }: { item: any }) => {
      const isGroupConv = !!item.isGroup;
      const otherUser = isGroupConv ? null : getOtherUser(item);
      const otherUserId = !isGroupConv && otherUser
        ? (typeof otherUser === 'string' ? otherUser : otherUser?._id)
        : null;
      const uid = otherUserId?.toString?.() ?? (otherUserId != null ? String(otherUserId) : '');
      const ring = uid ? storyByUserId[uid] : undefined;

      return (
        <ConversationListItem
          item={item}
          borderColor={colors.border}
          textColor={colors.text}
          textGray={colors.textGray}
          primaryColor={colors.primary}
          avatarBg={colors.avatarBg}
          successColor={colors.success}
          backgroundColor={colors.background}
          isOnline={!!uid && isUserOnline(uid)}
          hasStory={!!ring?.storyId}
          hasUnviewedStory={!!ring?.storyId && !!ring?.hasUnviewed}
          unknownLabel={t('unknown')}
          noMessagesLabel={t('noMessagesYet')}
          deleteTitle={t('deleteConversationQuestion')}
          deleteWarning={t('deleteConversationWarning')}
          cancelLabel={t('cancel')}
          deleteLabel={t('delete')}
          errorLabel={t('error')}
          deleteFailedLabel={t('failedToDeleteConversation')}
          onOpen={handleOpenConversation}
          onAvatarPress={onMessagingAvatarPress}
          onRemoved={handleConversationRemoved}
          getOtherUser={getOtherUser}
        />
      );
    },
    [
      colors,
      storyByUserId,
      isUserOnline,
      t,
      handleOpenConversation,
      onMessagingAvatarPress,
      handleConversationRemoved,
      getOtherUser,
    ],
  );

  const conversationKeyExtractor = useCallback((item: any, index: number) => {
    const id = item._id?.toString?.() ?? String(item._id);
    return id || `conversation-${index}`;
  }, []);

  const searchSections = React.useMemo(() => {
    const sections: Array<{ key: string; title: string; data: any[] }> = [];
    if (searchConversationResults.length > 0) {
      sections.push({ key: 'chats', title: t('messages'), data: searchConversationResults });
    }
    if (searchResults.length > 0) {
      sections.push({ key: 'people', title: t('searchUsers'), data: searchResults });
    }
    return sections;
  }, [searchConversationResults, searchResults, t]);

  const renderSearchUser = useCallback(
    ({ item }: { item: any }) => {
      const isOnline = item._id ? isUserOnline(item._id) : false;
      const uid = item._id?.toString?.() ?? String(item._id);
      const ring = storyByUserId[uid];
      const showRing = !!ring?.storyId;
      return (
        <TouchableOpacity
          style={[styles.searchResultItem, styles.rowLtr, { borderBottomColor: colors.border }]}
          onPress={() => handleStartConversation(item)}
        >
          <View style={styles.avatarContainer}>
            <StoryAvatarRing
              visible={showRing}
              showAnimatedRedFill={!!ring?.storyId && !!ring?.hasUnviewed}
              replayKey={storyRingReplayKey}
              ringOuterSize={LIST_RING_OUTER}
              avatarSize={LIST_AVATAR}
              strokeWidth={LIST_RING_STROKE}
            >
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => onMessagingAvatarPress(uid, item)}
              >
                {item.profilePic ? (
                  <Image source={{ uri: item.profilePic }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                    <Text style={styles.avatarText}>
                      {item.name?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            </StoryAvatarRing>
            {isOnline ? (
              <View style={[styles.onlineDot, { backgroundColor: colors.success, borderColor: colors.background }]} />
            ) : null}
          </View>
          <View style={[styles.searchResultInfo, styles.colLtr]}>
            <View style={styles.userNameRow}>
              <Text
                {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
                style={[styles.userName, LTR_TEXT, { color: colors.text }]}
              >
                {item.name || t('unknown')}
              </Text>
            </View>
            <Text
              {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
              style={[styles.userUsername, LTR_TEXT, { color: colors.textGray }]}
            >
              @{item.username}
            </Text>
          </View>
        </TouchableOpacity>
      );
    },
    [
      colors,
      storyByUserId,
      storyRingReplayKey,
      isUserOnline,
      handleStartConversation,
      onMessagingAvatarPress,
      t,
    ],
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('messages')}</Text>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateGroup', { followingUsers })}
          style={{ padding: 4 }}
        >
          <Text style={{ fontSize: 22, color: colors.primary }}>👥+</Text>
        </TouchableOpacity>
      </View>

      {/* Search Input */}
      <View style={[styles.searchContainer, { borderBottomColor: colors.border }]}>
        <TextInput
          style={[styles.searchInput, { backgroundColor: colors.backgroundLight, color: colors.text, borderColor: colors.border }]}
          placeholder={t('searchUsers')}
          placeholderTextColor={colors.textGray}
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      {/* Search Results */}
      {searchQuery.trim() && (
        <View style={[styles.searchResultsContainer, { borderBottomColor: colors.border }]}>
          {searching ? (
            <View style={styles.searchLoading}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : searchSections.length > 0 ? (
            <SectionList
              sections={searchSections}
              keyExtractor={(item, index) => item._id?.toString?.() ?? String(item._id ?? index)}
              renderSectionHeader={({ section }) => (
                <Text style={[styles.searchSectionTitle, { color: colors.textGray, backgroundColor: colors.background }]}>
                  {section.title}
                </Text>
              )}
              renderItem={({ item, section }) =>
                section.key === 'chats'
                  ? renderConversation({ item })
                  : renderSearchUser({ item })
              }
              stickySectionHeadersEnabled={false}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <View style={styles.searchEmpty}>
              <Text style={[styles.searchEmptyText, { color: colors.textGray }]}>{t('noUsersFound')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Conversations List */}
      {!searchQuery.trim() && (
        <FlatList
          data={conversations}
          renderItem={renderConversation}
          keyExtractor={conversationKeyExtractor}
          windowSize={5}
          maxToRenderPerBatch={6}
          initialNumToRender={6}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === 'android'}
          onEndReached={() => {
            if (loadingMoreConversations || !hasMoreConversations) return;
            fetchConversations(true);
          }}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMoreConversations ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: colors.text }]}>{t('noConversations')}</Text>
              <Text style={[styles.emptySubtext, { color: colors.textGray }]}>{t('startConversation')}</Text>
            </View>
          }
        />
      )}
      <StoryOrProfileSheet
        visible={!!storySheet}
        onClose={() => setStorySheet(null)}
        username={storySheet?.username}
        onSeeStory={() => {
          if (storySheet?.userId) {
            navigateToMainStack(navigation, 'StoryViewer', { userId: storySheet.userId });
          }
        }}
        onGoToProfile={
          storySheet?.username
            ? () =>
                navigation.navigate('Profile', {
                  screen: 'UserProfile',
                  params: { username: storySheet.username },
                })
            : undefined
        }
      />
    </View>
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
  header: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  conversationItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  /** Force row order (avatar | text | actions) regardless of app RTL. */
  rowLtr: {
    direction: 'ltr',
  },
  colLtr: {
    direction: 'ltr',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 15,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.success,
    borderWidth: 2,
    borderColor: COLORS.background,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  /** Lets long group names ellipsis instead of pushing time + delete off-screen */
  conversationTitleCol: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  rightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  deleteBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  deleteIcon: {
    fontSize: 16,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  time: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  lastMessageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    color: COLORS.textGray,
    flex: 1,
  },
  unreadMessage: {
    fontWeight: 'bold',
    color: COLORS.text,
  },
  unreadBadge: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 10,
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 50,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  searchContainer: {
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInput: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 16,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchResultsContainer: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 6,
  },
  searchLoading: {
    padding: 20,
    alignItems: 'center',
  },
  searchResultItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  searchResultInfo: {
    marginLeft: 15,
    flex: 1,
  },
  userUsername: {
    fontSize: 14,
    color: COLORS.textGray,
    marginTop: 2,
  },
  searchEmpty: {
    padding: 20,
    alignItems: 'center',
  },
  searchEmptyText: {
    fontSize: 14,
    color: COLORS.textGray,
  },
});

export default MessagesScreen;
