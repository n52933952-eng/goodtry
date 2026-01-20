import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const MessagesScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const { onlineUsers } = useSocket();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [followingUsers, setFollowingUsers] = useState<any[]>([]);

  useEffect(() => {
    fetchConversations();
    fetchFollowingUsers();
  }, []);

  const fetchConversations = async () => {
    try {
      const data = await apiService.get(ENDPOINTS.GET_CONVERSATIONS);
      const convos = data.conversations || data || [];
      setConversations(convos);
    } catch (error: any) {
      console.error('Error fetching conversations:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchFollowingUsers = async () => {
    if (!user?._id) return;
    
    try {
      // Get current user's profile which includes the 'following' array
      const currentUserData = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${user._id}`);
      const followingIds = currentUserData.following || [];
      
      if (followingIds.length === 0) {
        setFollowingUsers([]);
        return;
      }
      
      // Fetch full user profiles for each following ID
      const userPromises = followingIds.map(async (userId: string) => {
        try {
          const userData = await apiService.get(`${ENDPOINTS.GET_USER_PROFILE}/${userId}`);
          return userData;
        } catch (error) {
          console.warn(`Error fetching user ${userId}:`, error);
          return null;
        }
      });
      
      const users = (await Promise.all(userPromises)).filter((u) => u !== null);
      setFollowingUsers(users);
    } catch (error: any) {
      console.error('Error fetching following users:', error);
      setFollowingUsers([]);
    }
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      // Search through following users (client-side filter for better UX)
      const filtered = followingUsers.filter((u: any) => {
        const name = (u.name || '').toLowerCase();
        const username = (u.username || '').toLowerCase();
        const searchTerm = query.toLowerCase();
        return name.includes(searchTerm) || username.includes(searchTerm);
      });
      setSearchResults(filtered);
    } catch (error: any) {
      console.error('Error searching users:', error);
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

    return (
      <TouchableOpacity
        style={styles.conversationItem}
        onPress={() => navigation.navigate('ChatScreen', { 
          conversationId: item._id,
          otherUser: otherUserData 
        })}
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
                {otherUserData?.name || 'Unknown'}
              </Text>
            </View>
            {item.lastMessage && (
              <Text style={styles.time}>
                {formatTime(item.lastMessage.createdAt || item.updatedAt)}
              </Text>
            )}
          </View>
          <View style={styles.lastMessageRow}>
            <Text 
              style={[styles.lastMessage, unreadCount > 0 && styles.unreadMessage]}
              numberOfLines={1}
            >
              {item.lastMessage?.text || 'No messages yet'}
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
        <Text style={styles.headerTitle}>Messages</Text>
      </View>

      {/* Search Input */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search users you follow..."
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
                        <Text style={styles.userName}>{item.name || 'Unknown'}</Text>
                      </View>
                      <Text style={styles.userUsername}>@{item.username}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <View style={styles.searchEmpty}>
              <Text style={styles.searchEmptyText}>No users found</Text>
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
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No conversations yet</Text>
              <Text style={styles.emptySubtext}>Search for users you follow to start a conversation!</Text>
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
