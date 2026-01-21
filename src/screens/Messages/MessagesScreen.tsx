import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useLanguage } from '../../context/LanguageContext';

const MessagesScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const { onlineUsers, socket, selectedConversationId } = useSocket();
  const { t } = useLanguage();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMoreConversations, setLoadingMoreConversations] = useState(false);
  const [hasMoreConversations, setHasMoreConversations] = useState(false);
  const isFetchingConversationsRef = useRef(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [followingUsers, setFollowingUsers] = useState<any[]>([]);

  useEffect(() => {
    fetchFollowingUsers();
  }, []);

  // Listen for real-time message updates
  useEffect(() => {
    if (!socket || !user?._id) return;

    const handleNewMessage = (messageData: any) => {
      console.log('💬 [MessagesScreen] New message received:', messageData);
      
      setConversations((prevConvos) => {
        const conversationId = messageData.conversationId?.toString();
        if (!conversationId) return prevConvos;

        // Get sender ID (handle both populated object and ID string)
        const senderId = messageData.sender?._id?.toString() || messageData.sender?.toString() || messageData.sender;
        const isOwnMessage = senderId === user._id.toString();
        const isConversationOpen =
          !!selectedConversationId &&
          selectedConversationId.toString() === conversationId.toString();

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
          fetchConversations(false, { silent: true });
          return prevConvos;
        }
      });
    };

    const handleUnreadCountUpdate = (data: any) => {
      console.log('🔔 [MessagesScreen] Unread count update:', data);
      // Optionally update total unread count if needed
    };

    const handleMessagesSeen = (data: any) => {
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
    };

    socket.on('newMessage', handleNewMessage);
    socket.on('unreadCountUpdate', handleUnreadCountUpdate);
    socket.on('messagesSeen', handleMessagesSeen);

    return () => {
      socket.off('newMessage', handleNewMessage);
      socket.off('unreadCountUpdate', handleUnreadCountUpdate);
      socket.off('messagesSeen', handleMessagesSeen);
    };
  }, [socket, user?._id]);

  // Refresh conversations when screen comes into focus (e.g., when returning from ChatScreen)
  useFocusEffect(
    React.useCallback(() => {
      // Silent refresh so header/search doesn't flicker when coming back from ChatScreen
      fetchConversations(false, { silent: true });
    }, [])
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

  // Check if a user is online
  const isUserOnline = (userId: string) => {
    if (!onlineUsers || !Array.isArray(onlineUsers)) return false;
    
    const userIdStr = userId?.toString();
    return onlineUsers.some((online: any) => {
      let onlineUserId = null;
      if (typeof online === 'object' && online !== null) {
        onlineUserId = online.userId?.toString() || online._id?.toString() || online.toString();
      } else {
        onlineUserId = online?.toString();
      }
      return onlineUserId === userIdStr;
    });
  };

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

  const renderConversation = ({ item }: { item: any }) => {
    const otherUser = getOtherUser(item);
    if (!otherUser) return null;

    const otherUserData = typeof otherUser === 'string' ? null : otherUser;
    const otherUserId = typeof otherUser === 'string' ? otherUser : otherUser?._id;
    const unreadCount = item.unreadCount || 0;
    const isOnline = otherUserId ? isUserOnline(otherUserId) : false;

    const confirmDeleteConversation = () => {
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

    return (
      <TouchableOpacity
        style={styles.conversationItem}
        onPress={() => navigation.navigate('ChatScreen', { 
          conversationId: item._id,
          otherUser: otherUserData 
        })}
        onLongPress={confirmDeleteConversation}
      >
        <View style={styles.avatarContainer}>
          {otherUserData?.profilePic ? (
            <Image source={{ uri: otherUserData.profilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {otherUserData?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          {isOnline && <View style={styles.onlineDot} />}
        </View>
        <View style={styles.conversationInfo}>
          <View style={styles.conversationHeader}>
            <View style={styles.userNameRow}>
              <Text style={styles.userName}>
                {otherUserData?.name || t('unknown')}
              </Text>
            </View>
            <View style={styles.rightHeader}>
              {item.lastMessage && (
                <Text style={styles.time}>
                  {formatTime(item.lastMessage.createdAt || item.updatedAt)}
                </Text>
              )}
              <TouchableOpacity
                onPress={confirmDeleteConversation}
                style={styles.deleteBtn}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.deleteIcon}>🗑️</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.lastMessageRow}>
            <Text 
              style={[styles.lastMessage, unreadCount > 0 && styles.unreadMessage]}
              numberOfLines={1}
            >
              {item.lastMessage?.text || t('noMessagesYet')}
            </Text>
            {unreadCount > 0 && (
              <View style={styles.unreadBadge}>
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
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{t('messages')}</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder={t('searchUsers')}
          placeholderTextColor={COLORS.textGray}
          value={searchQuery}
          onChangeText={handleSearch}
        />
      </View>

      {/* Search Results */}
      {searchQuery.trim() && (
        <View style={styles.searchResultsContainer}>
          {searching ? (
            <View style={styles.searchLoading}>
              <ActivityIndicator size="small" color={COLORS.primary} />
            </View>
          ) : searchResults.length > 0 ? (
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item._id?.toString() || String(item._id)}
              renderItem={({ item }) => {
                const isOnline = item._id ? isUserOnline(item._id) : false;
                return (
                  <TouchableOpacity
                    style={styles.searchResultItem}
                    onPress={() => handleStartConversation(item)}
                  >
                    <View style={styles.avatarContainer}>
                      {item.profilePic ? (
                        <Image source={{ uri: item.profilePic }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatar, styles.avatarPlaceholder]}>
                          <Text style={styles.avatarText}>
                            {item.name?.[0]?.toUpperCase() || '?'}
                          </Text>
                        </View>
                      )}
                      {isOnline && <View style={styles.onlineDot} />}
                    </View>
                    <View style={styles.searchResultInfo}>
                      <View style={styles.userNameRow}>
                        <Text style={styles.userName}>{item.name || t('unknown')}</Text>
                      </View>
                      <Text style={styles.userUsername}>@{item.username}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <View style={styles.searchEmpty}>
              <Text style={styles.searchEmptyText}>{t('noUsersFound')}</Text>
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
                <ActivityIndicator size="small" color={COLORS.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>{t('noConversations')}</Text>
              <Text style={styles.emptySubtext}>{t('startConversation')}</Text>
            </View>
          }
        />
      )}
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
