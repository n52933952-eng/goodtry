import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  TextInput,
  Alert,
  AppState,
  DeviceEventEmitter,
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
import { navigateToMainStack } from '../../utils/navigationHelpers';

const LIST_AVATAR = 50;
const LIST_RING_OUTER = 56;
const LIST_RING_STROKE = 2;

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
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
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

  // Update selectedConversationId ref whenever it changes
  useEffect(() => {
    selectedConversationIdRef.current = selectedConversationId || null;
  }, [selectedConversationId]);

  // Handle new messages - STABLE FUNCTION (like web version)
  const handleNewMessage = React.useCallback((messageData: any) => {
    console.log('🔔🔔🔔 [MessagesScreen] handleNewMessage: Received newMessage event!', {
      hasData: !!messageData,
      conversationId: messageData?.conversationId,
      selectedConversationId: selectedConversationIdRef.current,
      senderId: messageData?.sender?._id || messageData?.sender,
      currentUserId: user?._id,
      messageId: messageData?._id,
      messageText: messageData?.text?.substring(0, 30)
    });
    
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
        const lastMessageText = messageData.text || (messageData.img ? '📷 Image' : '');
        
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

        // Move to top WITHOUT full re-sort (new message => most recent)
        return [updatedConversation, ...prevConvos.filter((_, i) => i !== existingIndex)];
      } else {
        // New conversation - fetch it from API to get full conversation data
        console.log('💬 [MessagesScreen] New conversation detected, fetching...');
        // Silent refresh so header/search doesn't flash a full-screen spinner
        if (fetchConversationsRef.current) {
          fetchConversationsRef.current(false, { silent: true });
        }
        return prevConvos;
      }
    });
  }, [user?._id]);

  const handleUnreadCountUpdate = React.useCallback((data: any) => {
    console.log('🔔 [MessagesScreen] Unread count update:', data);
    // Optionally update total unread count if needed
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
      socket.on('newMessage', handleNewMessage);
      socket.on('unreadCountUpdate', handleUnreadCountUpdate);
      socket.on('conversationMarkedRead', handleMessagesSeen);
      console.log('✅ [MessagesScreen] Conversation socket listeners bound');
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
    };
  }, [socket, user?._id, handleNewMessage, handleUnreadCountUpdate, handleMessagesSeen]);

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
      setStoryRingReplayKey((k) => k + 1);
      fetchStoryStrip();
      // On first load, show loading spinner if no conversations yet
      // On subsequent loads (returning from ChatScreen), refresh silently
      const isFirstLoad = isFirstLoadRef.current;
      if (isFirstLoad) {
        isFirstLoadRef.current = false;
      }
      fetchConversations(false, { silent: !isFirstLoad });
      
      // Refresh following users list so newly followed users appear in search
      fetchFollowingUsers();
      refreshPresenceSubscription();
    }, [refreshPresenceSubscription, fetchStoryStrip])
  );

  const fetchConversations = async (
    loadMore = false,
    opts: { silent?: boolean } = {}
  ) => {
    // Prevent duplicate requests (but allow the very first fetch even if loading=true initially)
    if (isFetchingConversationsRef.current) return;
    if (loadMore && (loadingMoreConversations || !hasMoreConversations)) return;

    if (loadMore) {
      setLoadingMoreConversations(true);
    } else {
      // Only show full-page spinner on first load; otherwise refresh silently
      const shouldShowSpinner = !opts.silent && conversations.length === 0;
      if (shouldShowSpinner) setLoading(true);
    }

    try {
      isFetchingConversationsRef.current = true;
      const beforeId = loadMore && conversations.length > 0
        ? conversations[conversations.length - 1]?._id
        : null;

      const url = `${ENDPOINTS.GET_CONVERSATIONS}?limit=20${beforeId ? `&beforeId=${beforeId}` : ''}`;
      
      const data = await apiService.get(url);

      const convos = data?.conversations || data || [];
      const hasMore = data?.hasMore === true;

      setHasMoreConversations(hasMore);

      if (loadMore) {
        // Append, dedupe by _id (preserve order: existing first, then new)
        setConversations((prev) => {
          const map = new Map<string, any>();
          prev.forEach((c) => map.set(c._id?.toString?.() ?? String(c._id), c));
          convos.forEach((c: any) => map.set(c._id?.toString?.() ?? String(c._id), c));
          return Array.from(map.values());
        });
      } else {
        // Backend already sorts by updatedAt desc
        setConversations(convos);
      }
    } catch (error: any) {
      console.error('❌ [MessagesScreen] fetchConversations: Error', error);
      if (!loadMore) {
        setConversations([]);
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

  // Watch presence for all users in current conversations so status updates in real time
  // without needing to open an individual chat first.
  useEffect(() => {
    if (!user?._id) {
      setPresenceWatchUserIds([]);
      return;
    }

    const myId = user._id?.toString?.() ?? String(user._id);
    const partnerIds = conversations
      .map((conversation: any) => {
        const participants = Array.isArray(conversation?.participants) ? conversation.participants : [];
        const other = participants.find((p: any) => {
          const pid = p?._id?.toString?.() ?? p?.toString?.() ?? String(p);
          return pid && pid !== myId;
        });
        return other?._id?.toString?.() ?? other?.toString?.() ?? (other != null ? String(other) : '');
      })
      .filter((id: string) => !!id);

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
      console.log('🔍 [MessagesScreen] fetchFollowingUsers: No user._id, skipping');
      return;
    }
    
      // Light log (avoid huge JSON.stringify in dev)
      console.log('🔍 [MessagesScreen] fetchFollowingUsers: fetching...');
    try {
      // Scalable: backend already provides a dedicated endpoint returning user objects (limited to 30)
      const data = await apiService.get(ENDPOINTS.GET_FOLLOWING_USERS);
      const users = Array.isArray(data) ? data : (data?.users || []);
      console.log('🔍 [MessagesScreen] fetchFollowingUsers: count =', users.length);
      
      setFollowingUsers(users);
    } catch (error: any) {
      console.error('❌ [MessagesScreen] fetchFollowingUsers: Error:', error);
      setFollowingUsers([]);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    console.log('🔍 [MessagesScreen] handleSearch:', { query, followingCount: followingUsers.length });
    
    if (!query.trim()) {
      console.log('🔍 [MessagesScreen] handleSearch: Empty query, clearing results');
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const searchTerm = query.toLowerCase();
      // Search through following users (client-side filter for better UX)
      
      const filtered = followingUsers.filter((u: any) => {
        const name = (u.name || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        const nameMatch = name.includes(searchTerm);
        const usernameMatch = username.includes(searchTerm);
        const matches = nameMatch || usernameMatch;
        return matches;
      });
      
      console.log('🔍 [MessagesScreen] handleSearch: Filtered results count:', filtered.length);
      
      setSearchResults(filtered);
    } catch (error: any) {
      console.error('❌ [MessagesScreen] handleSearch: Error:', error);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const handleStartConversation = async (selectedUser: any) => {
    try {
      // Check if conversation already exists
      const existingConvo = conversations.find((conv: any) => {
        const otherUser = getOtherUser(conv);
        const otherUserId = typeof otherUser === 'string' ? otherUser : otherUser?._id;
        return otherUserId === selectedUser._id;
      });

      if (existingConvo) {
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
      setSearchResults([]);
    } catch (error: any) {
      console.error('Error starting conversation:', error);
    }
  };

  const getOtherUser = (conversation: any) => {
    if (!conversation.participants || !user) return null;
    return conversation.participants.find((p: any) => {
      const pId = typeof p === 'string' ? p : p._id;
      return pId !== user._id;
    });
  };

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

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  // Handle group socket events
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

  const renderConversation = ({ item }: { item: any }) => {
    const isGroupConv = !!item.isGroup;
    const otherUser = isGroupConv ? null : getOtherUser(item);
    if (!isGroupConv && !otherUser) return null;

    const otherUserData = (!isGroupConv && typeof otherUser !== 'string') ? otherUser : null;
    const otherUserId = (!isGroupConv && otherUser) ? (typeof otherUser === 'string' ? otherUser : otherUser?._id) : null;
    const unreadCount = item.unreadCount || 0;
    const isOnline = (!isGroupConv && otherUserId) ? isUserOnline(otherUserId) : false;

    const confirmDeleteConversation = () => {
      if (isGroupConv) {
        Alert.alert('Leave Group', `Leave "${item.groupName || 'group'}"?`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Leave',
            style: 'destructive',
            onPress: async () => {
              try {
                await apiService.post(`${ENDPOINTS.LEAVE_GROUP}/${item._id}/leave`, {});
                setConversations((prev) => prev.filter((c) => c._id?.toString() !== item._id?.toString()));
              } catch (e: any) {
                Alert.alert('Error', e?.message || 'Failed to leave group');
              }
            },
          },
        ]);
        return;
      }
      Alert.alert(
        t('deleteConversationQuestion'),
        t('deleteConversationWarning'),
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('delete'),
            style: 'destructive',
            onPress: async () => {
              try {
                await apiService.delete(`${ENDPOINTS.DELETE_CONVERSATION}/${item._id}`);
                setConversations((prev) =>
                  prev.filter((c) => (c._id?.toString?.() ?? String(c._id)) !== (item._id?.toString?.() ?? String(item._id)))
                );
              } catch (e: any) {
                console.error('❌ [MessagesScreen] delete conversation error:', e);
                Alert.alert(t('error'), e?.message || t('failedToDeleteConversation'));
              }
            },
          },
        ]
      );
    };

    const displayName = isGroupConv
      ? (item.groupName || 'Group')
      : (otherUserData?.name || t('unknown'));

    return (
      <TouchableOpacity
        style={[styles.conversationItem, { borderBottomColor: colors.border }]}
        onPress={() => navigation.navigate('ChatScreen', { 
          conversationId: item._id,
          otherUser: isGroupConv ? null : otherUserData,
          isGroup: isGroupConv,
          groupName: isGroupConv ? item.groupName : undefined,
          conversation: item,
        })}
        onLongPress={confirmDeleteConversation}
      >
        <View style={styles.avatarContainer}>
          {isGroupConv ? (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: '#1a4a8a' }]}>
              <Text style={[styles.avatarText, { fontSize: 22 }]}>👥</Text>
            </View>
          ) : (
            (() => {
              const uid = otherUserId?.toString?.() ?? String(otherUserId);
              const ring = storyByUserId[uid];
              const showRing = !!ring?.storyId;
              return (
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
                    onPress={() => onMessagingAvatarPress(uid, otherUserData)}
                  >
                    {otherUserData?.profilePic ? (
                      <Image source={{ uri: otherUserData.profilePic }} style={styles.avatar} />
                    ) : (
                      <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                        <Text style={styles.avatarText}>
                          {otherUserData?.name?.[0]?.toUpperCase() || '?'}
                        </Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </StoryAvatarRing>
              );
            })()
          )}
          {isOnline && <View style={[styles.onlineDot, { backgroundColor: colors.success, borderColor: colors.background }]} />}
        </View>
        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <View style={styles.userNameRow}>
              <Text style={[styles.userName, { color: colors.text }]}>{displayName}</Text>
              {isGroupConv && (
                <Text style={{ fontSize: 10, color: colors.primary, marginLeft: 4, fontWeight: '600' }}>GROUP</Text>
              )}
            </View>
            <View style={styles.rightHeader}>
              {item.lastMessage && (
                <Text style={[styles.time, { color: colors.textGray }]}>
                  {formatTime(item.lastMessage.createdAt || item.updatedAt)}
                </Text>
              )}
              <TouchableOpacity
                onPress={confirmDeleteConversation}
                style={styles.deleteBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.deleteIcon}>{isGroupConv ? '🚪' : '🗑️'}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {isGroupConv && (
            <Text style={[styles.lastMessage, { color: colors.textGray, fontSize: 12, marginBottom: 2 }]} numberOfLines={1}>
              {item.participants?.length || 0} members
            </Text>
          )}
          <View style={styles.lastMessageRow}>
            <Text 
              style={[
                styles.lastMessage, 
                { color: colors.textGray },
                unreadCount > 0 && styles.unreadMessage,
                unreadCount > 0 && { color: colors.text }
              ]}
              numberOfLines={1}
            >
              {item.lastMessage?.text || t('noMessagesYet')}
            </Text>
            {unreadCount > 0 && (
              <View style={[styles.unreadBadge, { backgroundColor: colors.primary }]}>
                <Text style={styles.unreadText}>{unreadCount}</Text>
              </View>
            )}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

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
          ) : searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item._id?.toString() || String(item._id)}
              renderItem={({ item }) => {
                const isOnline = item._id ? isUserOnline(item._id) : false;
                return (
                  <TouchableOpacity
                    style={[styles.searchResultItem, { borderBottomColor: colors.border }]}
                    onPress={() => handleStartConversation(item)}
                  >
                    <View style={styles.avatarContainer}>
                      {(() => {
                        const uid = item._id?.toString?.() ?? String(item._id);
                        const ring = storyByUserId[uid];
                        const showRing = !!ring?.storyId;
                        return (
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
                        );
                      })()}
                      {isOnline && <View style={[styles.onlineDot, { backgroundColor: colors.success, borderColor: colors.background }]} />}
                    </View>
                    <View style={styles.searchResultInfo}>
                      <View style={styles.userNameRow}>
                        <Text style={[styles.userName, { color: colors.text }]}>{item.name || t('unknown')}</Text>
                      </View>
                      <Text style={[styles.userUsername, { color: colors.textGray }]}>@{item.username}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
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
          keyExtractor={(item, index) => {
            const id = item._id?.toString?.() ?? String(item._id);
            return id || `conversation-${index}`;
          }}
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
  rightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    maxHeight: 300,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
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
