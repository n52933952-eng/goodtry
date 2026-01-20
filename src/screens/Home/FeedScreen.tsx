import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { usePost } from '../../context/PostContext';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { apiService } from '../../services/api';
import { ENDPOINTS, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import ChannelsModal from '../../components/ChannelsModal';
import ActivityModal from '../../components/ActivityModal';

interface AvailableUser {
  _id: string;
  name: string;
  username: string;
  profilePic?: string;
}

const FeedScreen = ({ navigation }: any) => {
  const { posts, setPosts } = usePost();
  const { user, logout } = useUser();
  const { socket, onlineUsers, notificationCount } = useSocket();
  const showToast = useShowToast();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showChessModal, setShowChessModal] = useState(false);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [incomingChallenge, setIncomingChallenge] = useState<any>(null);
  const [busyChessUserIds, setBusyChessUserIds] = useState<string[]>([]);
  const [showChannelsModal, setShowChannelsModal] = useState(false);
  const [showActivityModal, setShowActivityModal] = useState(false);

  useEffect(() => {
    fetchFeed();
    
    const timeout = setTimeout(() => {
      if (loading) {
        console.warn('⚠️ Feed fetch timeout - stopping loading spinner');
        setLoading(false);
        setPosts([]);
        showToast('Warning', 'Feed took too long to load', 'warning');
      }
    }, 10000);
    
    return () => clearTimeout(timeout);
  }, []);

  // Listen for new posts (like web's handleNewPost - maintains 3 newest posts per user rule)
  useEffect(() => {
    if (!socket) return;

    const handleNewPost = (newPost: any) => {
      console.log('📨 [FeedScreen] New post received via socket:', newPost._id);
      
      setPosts(prev => {
        // Check if post already exists (prevent duplicates)
        const exists = prev.some(p => {
          const prevId = p._id?.toString();
          const newId = newPost._id?.toString();
          return prevId === newId;
        });
        
        if (exists) {
          console.log('⚠️ [FeedScreen] Duplicate post detected, skipping:', newPost._id);
          return prev;
        }
        
        // Get the author ID of the new post
        const newPostAuthorId = newPost.postedBy?._id?.toString() || newPost.postedBy?.toString();
        
        if (!newPostAuthorId) {
          console.log('⚠️ [FeedScreen] New post has no author, skipping:', newPost._id);
          return prev;
        }
        
        // Filter out posts from the same author
        const postsFromOtherAuthors = prev.filter(p => {
          const postAuthorId = p.postedBy?._id?.toString() || p.postedBy?.toString();
          return postAuthorId !== newPostAuthorId;
        });
        
        // Get posts from the same author (excluding the new one)
        const postsFromSameAuthor = prev.filter(p => {
          const postAuthorId = p.postedBy?._id?.toString() || p.postedBy?.toString();
          return postAuthorId === newPostAuthorId;
        });
        
        // Sort same author posts by createdAt (newest first)
        postsFromSameAuthor.sort((a, b) => {
          const dateA = new Date(a.createdAt).getTime();
          const dateB = new Date(b.createdAt).getTime();
          return dateB - dateA;
        });
        
        // Keep only the 2 newest posts from same author (new post will be the 3rd)
        // This maintains the "3 newest posts per user" rule
        const keptSameAuthorPosts = postsFromSameAuthor.slice(0, 2);
        
        // Combine: new post + kept same author posts + other authors' posts
        const updatedFeed = [newPost, ...keptSameAuthorPosts, ...postsFromOtherAuthors];
        
        // Sort all by updatedAt (or createdAt if no updatedAt) - matches backend sorting logic
        updatedFeed.sort((a, b) => {
          const dateA = new Date(a.updatedAt || a.createdAt).getTime();
          const dateB = new Date(b.updatedAt || b.createdAt).getTime();
          return dateB - dateA; // Newest first
        });
        
        console.log(`✅ [FeedScreen] Added new post to feed (maintained 3 newest per user rule):`, newPost._id);
        return updatedFeed;
      });
    };

    const handlePostDeleted = ({ postId }: { postId: string }) => {
      console.log('🗑️ [FeedScreen] Post deleted via socket:', postId);
      setPosts(prev => {
        const updated = prev.filter(p => p._id?.toString() !== postId?.toString());
        console.log(`🗑️ [FeedScreen] Removed post ${postId}, feed now has ${updated.length} posts`);
        return updated;
      });
    };

    const handlePostUpdated = (data: any) => {
      const postId = data.postId || data._id;
      const updatedPost = data.post || data;
      
      console.log('✏️ [FeedScreen] Post updated via socket:', postId);
      
      setPosts(prev => {
        const postIndex = prev.findIndex(p => p._id?.toString() === postId?.toString());
        
        if (postIndex !== -1) {
          // Update existing post
          const updated = [...prev];
          updated[postIndex] = { ...updated[postIndex], ...updatedPost };
          
          // Sort by updatedAt (or createdAt) - newest first
          updated.sort((a, b) => {
            const dateA = new Date(a.updatedAt || a.createdAt).getTime();
            const dateB = new Date(b.updatedAt || b.createdAt).getTime();
            return dateB - dateA;
          });
          
          return updated;
        }
        
        return prev;
      });
    };

    // Listen for chess challenges
    const handleChessChallenge = (data: any) => {
      if (data.to === user?._id) {
        setIncomingChallenge(data);
        showToast('Chess Challenge!', `${data.fromName} challenged you to chess!`, 'info');
      }
    };

    const handleAcceptChessChallenge = (data: any) => {
      // Backend sends: { roomId, yourColor, opponentId }
      if (!data?.roomId || !data?.yourColor) return;

      showToast('Challenge Accepted', 'Game starting!', 'success');
      navigation.navigate('ChessGame', { 
        roomId: data.roomId, 
        color: data.yourColor,
        opponentId: data.opponentId 
      });
    };

    socket.on('newPost', handleNewPost);
    socket.on('postDeleted', handlePostDeleted);
    socket.on('postUpdated', handlePostUpdated);
    socket.on('chessChallenge', handleChessChallenge);
    socket.on('acceptChessChallenge', handleAcceptChessChallenge);

    return () => {
      socket.off('newPost', handleNewPost);
      socket.off('postDeleted', handlePostDeleted);
      socket.off('postUpdated', handlePostUpdated);
      socket.off('chessChallenge', handleChessChallenge);
      socket.off('acceptChessChallenge', handleAcceptChessChallenge);
    };
  }, [socket, user, navigation, setPosts]);

  const fetchFeed = async () => {
    try {
      // Match web's feed fetching: limit=10&skip=0 for initial load
      const data = await apiService.get(`${ENDPOINTS.GET_FEED}?limit=10&skip=0`);
      const postsArray = Array.isArray(data.posts) ? data.posts : (Array.isArray(data) ? data : []);
      
      // Filter out duplicates by _id
      const uniquePosts = postsArray.filter((post: any, index: number, self: any[]) => {
        const postId = post._id?.toString?.() ?? String(post._id);
        return postId && self.findIndex((p: any) => {
          const pId = p._id?.toString?.() ?? String(p._id);
          return pId === postId;
        }) === index;
      });
      
      setPosts(uniquePosts);
      console.log(`📥 [FeedScreen] Fetched ${uniquePosts.length} unique posts from feed (${postsArray.length} total, ${postsArray.length - uniquePosts.length} duplicates filtered)`);
    } catch (error: any) {
      console.error('❌ Error fetching feed:', error);
      showToast('Error', error.message || 'Failed to load feed', 'error');
      setPosts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchFeed();
  };

  const fetchAvailableUsers = async () => {
    if (!user) return;

    setLoadingUsers(true);
    try {
      // 1) Fetch busy chess users (from Redis) so we can filter them out (same as web)
      try {
        const busyRes = await apiService.get('/api/user/busyChessUsers');
        const ids: string[] = busyRes?.busyUserIds || [];
        setBusyChessUserIds(ids.map((x) => x?.toString()).filter(Boolean));
      } catch (e) {
        // Best-effort; if it fails we still show online users.
        setBusyChessUserIds([]);
      }

      // 2) Fetch fresh current user profile to get latest following/followers (same as web)
      let freshUserData: any = user;
      try {
        freshUserData = await apiService.get(`/api/user/getUserPro/${user._id}`);
      } catch (e) {
        freshUserData = user;
      }

      // 3) Build candidate list from following + followers (same as web)
      const allConnectionIds = [
        ...(freshUserData?.following || []),
        ...(freshUserData?.followers || []),
      ].filter((id: any) => {
        const idStr = id?.toString().trim();
        if (!idStr || idStr.length !== 24) return false;
        return /^[0-9a-fA-F]{24}$/.test(idStr);
      });

      const uniqueIds = [...new Set(allConnectionIds.map((id: any) => id.toString()))];

      if (uniqueIds.length === 0) {
        setAvailableUsers([]);
        return;
      }

      // 4) Fetch each user profile (parallel)
      const userPromises = uniqueIds.map(async (userId) => {
        try {
          const userData = await apiService.get(`/api/user/getUserPro/${userId}`);
          if (userData && userData._id) return userData;
        } catch (err) {
          console.warn(`⚠️ Error fetching user ${userId}:`, err);
        }
        return null;
      });

      const allUsers = (await Promise.all(userPromises)).filter((u) => u !== null);

      // 5) Filter to only online users who are NOT busy, and not self (same as web)
      const onlineAvailableUsers = allUsers.filter((u: any) => {
        if (!onlineUsers || !Array.isArray(onlineUsers)) return false;
        const userIdStr = u._id?.toString();
        const currentUserIdStr = user._id?.toString();
        if (!userIdStr || !currentUserIdStr) return false;

        const isOnline = onlineUsers.some((online: any) => {
          let onlineUserId = null;
          if (typeof online === 'object' && online !== null) {
            onlineUserId = online.userId?.toString() || online.toString();
          } else {
            onlineUserId = online?.toString();
          }
          return onlineUserId === userIdStr;
        });

        const isNotSelf = userIdStr !== currentUserIdStr;
        const isNotBusy = !busyChessUserIds.some((busyId) => busyId?.toString() === userIdStr);

        return isOnline && isNotSelf && isNotBusy;
      });

      setAvailableUsers(onlineAvailableUsers);
    } catch (error) {
      console.error('Error fetching available users:', error);
      showToast('Error', 'Failed to fetch users', 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleOpenChessModal = () => {
    setShowChessModal(true);
    fetchAvailableUsers();
  };

  const handleSendChallenge = (opponent: AvailableUser) => {
    if (!socket) {
      showToast('Error', 'Not connected to server', 'error');
      return;
    }

    socket.emit('chessChallenge', {
      from: user?._id,
      to: opponent._id,
      fromName: user?.name,
      fromUsername: user?.username,
      fromProfilePic: user?.profilePic || '',
    });

    showToast('Success', `Challenge sent to ${opponent.name}!`, 'success');
    setShowChessModal(false);
  };

  const handleAcceptChallenge = () => {
    if (!socket || !incomingChallenge) return;

    const roomId = `chess_${incomingChallenge.from}_${user?._id}_${Date.now()}`;
    
    socket.emit('acceptChessChallenge', {
      from: user?._id,
      to: incomingChallenge.from,
      roomId: roomId,
    });

    navigation.navigate('ChessGame', { 
      roomId: roomId,
      color: 'black',
      opponentId: incomingChallenge.from
    });
    
    setIncomingChallenge(null);
    showToast('Success', 'Challenge accepted!', 'success');
  };

  const handleDeclineChallenge = () => {
    if (!socket || !incomingChallenge) return;

    socket.emit('declineChessChallenge', {
      from: user?._id,
      to: incomingChallenge.from,
    });

    setIncomingChallenge(null);
    showToast('Info', 'Challenge declined', 'info');
  };

  const handleLogout = async () => {
    try {
      // Use the single source of truth logout (clears @user and tells backend to clear cookie)
      await logout();
      showToast('Logged Out', 'You have been logged out', 'success');
    } catch (error) {
      console.error('❌ Error logging out:', error);
      showToast('Error', 'Failed to logout', 'error');
    }
  };

  const renderPost = ({ item }: { item: any }) => <Post post={item} />;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Feed</Text>
        <View style={styles.headerButtons}>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>🚪</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.createButton}
            onPress={() => navigation.navigate('CreatePost')}
          >
            <Text style={styles.createButtonText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.quickAccessRightRail}>
        <TouchableOpacity
          style={styles.quickAccessButton}
          onPress={() => navigation.navigate('Notifications')}
        >
          <View style={styles.notificationIconContainer}>
            <Text style={styles.quickAccessIcon}>🔔</Text>
            {notificationCount > 0 && (
              <View style={styles.notificationBadge}>
                <Text style={styles.notificationBadgeText}>
                  {notificationCount > 99 ? '99+' : notificationCount}
                </Text>
              </View>
            )}
          </View>
          <Text style={styles.quickAccessLabel}>Alerts</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessButton}
          onPress={handleOpenChessModal}
        >
          <Text style={styles.quickAccessIcon}>♟️</Text>
          <Text style={styles.quickAccessLabel}>Chess</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessButton}
          onPress={() => navigation.navigate('Weather')}
        >
          <Text style={styles.quickAccessIcon}>🌤️</Text>
          <Text style={styles.quickAccessLabel}>Weather</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessButton}
          onPress={() => navigation.navigate('Football')}
        >
          <Text style={styles.quickAccessIcon}>⚽</Text>
          <Text style={styles.quickAccessLabel}>Football</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessButton}
          onPress={() => setShowChannelsModal(true)}
        >
          <Text style={styles.quickAccessIcon}>📺</Text>
          <Text style={styles.quickAccessLabel}>Channels</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.quickAccessButton}
          onPress={() => setShowActivityModal(true)}
        >
          <Text style={styles.quickAccessIcon}>🔴</Text>
          <Text style={styles.quickAccessLabel}>Activity</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={posts}
        renderItem={renderPost}
        keyExtractor={(item, index) => {
          // Ensure unique keys by using both _id and index as fallback
          const id = item._id?.toString?.() ?? String(item._id);
          return id || `post-${index}`;
        }}
        contentContainerStyle={styles.listContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
          />
        }
        ListHeaderComponent={
          loading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
          ) : null
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No posts yet</Text>
            <Text style={styles.emptySubtext}>Follow users to see their posts</Text>
          </View>
        }
      />

      {/* Channels Modal */}
      <ChannelsModal
        visible={showChannelsModal}
        onClose={() => setShowChannelsModal(false)}
        onChannelFollowed={() => {
          fetchFeed(); // Refresh feed when channel is followed
        }}
      />

      {/* Activity Modal */}
      <ActivityModal
        visible={showActivityModal}
        onClose={() => setShowActivityModal(false)}
        onActivityClick={(activity) => {
          // Navigate to post or user profile based on activity
          if (activity.postId?._id) {
            // PostDetail is in the same FeedStack, so direct navigation works
            navigation.navigate('PostDetail', { postId: activity.postId._id });
            setShowActivityModal(false);
          } else if (activity.targetUser?.username) {
            navigation.navigate('UserProfile', { username: activity.targetUser.username });
            setShowActivityModal(false);
          } else if (activity.userId?.username) {
            navigation.navigate('UserProfile', { username: activity.userId.username });
            setShowActivityModal(false);
          }
        }}
      />

      {/* Chess Challenge Modal */}
      <Modal
        visible={showChessModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowChessModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>♟️ Challenge to Chess</Text>
              <TouchableOpacity onPress={() => setShowChessModal(false)}>
                <Text style={styles.modalCloseButton}>✕</Text>
              </TouchableOpacity>
            </View>
            
            <Text style={styles.modalSubtitle}>
              {loadingUsers
                ? 'Loading online users...'
                : availableUsers.length > 0
                ? 'Select a user to challenge:'
                : 'No online users available'}
            </Text>

            {loadingUsers ? (
              <View style={styles.modalLoading}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            ) : availableUsers.length > 0 ? (
              <FlatList
                data={availableUsers}
                keyExtractor={(item, index) => {
                  const id = item._id?.toString?.() ?? String(item._id);
                  return id || `user-${index}`;
                }}
                style={styles.userList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.userItem}
                    onPress={() => handleSendChallenge(item)}
                  >
                    <View style={styles.userInfo}>
                      <View style={styles.userAvatar}>
                        <Text style={styles.userAvatarText}>
                          {item.name?.charAt(0).toUpperCase() || '?'}
                        </Text>
                      </View>
                      <View>
                        <Text style={styles.userName}>{item.name}</Text>
                        <Text style={styles.userUsername}>@{item.username}</Text>
                      </View>
                    </View>
                    <View style={styles.onlineDot} />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <View style={styles.modalEmpty}>
                <Text style={styles.emptyText}>
                  No online users to challenge.{'\n'}
                  Follow users to challenge them!
                </Text>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Incoming Challenge Modal */}
      <Modal
        visible={!!incomingChallenge}
        transparent
        animationType="slide"
        onRequestClose={() => setIncomingChallenge(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.challengeModalContent}>
            <Text style={styles.challengeModalTitle}>♟️ Chess Challenge!</Text>
            <Text style={styles.challengeModalText}>
              {incomingChallenge?.fromName} challenged you to a chess match!
            </Text>
            <View style={styles.challengeModalButtons}>
              <TouchableOpacity
                style={[styles.challengeModalButton, styles.declineButton]}
                onPress={handleDeclineChallenge}
              >
                <Text style={styles.challengeModalButtonText}>Decline</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.challengeModalButton, styles.acceptButton]}
                onPress={handleAcceptChallenge}
              >
                <Text style={styles.challengeModalButtonText}>Accept</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
  },
  logoutButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutButtonText: {
    fontSize: 20,
  },
  createButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  listContainer: {
    paddingBottom: 20,
    paddingRight: 96, // leave space for the right-side quick actions rail
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
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
  inlineLoading: {
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickAccessRightRail: {
    position: 'absolute',
    right: 10,
    top: 100, // moved up from 140
    zIndex: 10,
    alignItems: 'flex-end',
    gap: 8, // reduced gap
  },
  quickAccessButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8, // reduced from 10
    paddingHorizontal: 6, // reduced from 8
    minWidth: 60, // reduced from 72
    borderRadius: 10, // reduced from 12
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  quickAccessIcon: {
    fontSize: 22, // reduced from 28
    marginBottom: 3, // reduced from 4
  },
  quickAccessLabel: {
    fontSize: 10, // reduced from 11
    color: COLORS.text,
    fontWeight: '600',
  },
  notificationIconContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationBadge: {
    position: 'absolute',
    top: -6,
    right: -8,
    backgroundColor: '#FF3B30',
    borderRadius: 10,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: COLORS.backgroundLight,
  },
  notificationBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    maxHeight: '70%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  modalCloseButton: {
    fontSize: 24,
    color: COLORS.textGray,
    padding: 4,
  },
  modalSubtitle: {
    fontSize: 14,
    color: COLORS.textGray,
    marginBottom: 16,
    textAlign: 'center',
  },
  modalLoading: {
    padding: 40,
    alignItems: 'center',
  },
  modalEmpty: {
    padding: 40,
    alignItems: 'center',
  },
  userList: {
    maxHeight: 300,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 8,
    backgroundColor: COLORS.background,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  userAvatarText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 2,
  },
  userUsername: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  onlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
  },
  challengeModalContent: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 16,
    padding: 24,
    width: '90%',
    maxWidth: 350,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  challengeModalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 16,
    textAlign: 'center',
  },
  challengeModalText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 22,
  },
  challengeModalButtons: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  challengeModalButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  declineButton: {
    backgroundColor: COLORS.error,
  },
  acceptButton: {
    backgroundColor: COLORS.success,
  },
  challengeModalButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
});

export default FeedScreen;
