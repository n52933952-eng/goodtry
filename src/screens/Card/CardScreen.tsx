import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { API_URL, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';

interface CardChallenge {
  _id: string;
  challenger: any;
  opponent: any;
  status: string;
  createdAt: string;
}

interface AvailableUser {
  _id: string;
  name: string;
  username: string;
  profilePic?: string;
}

const CardScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const { socket, onlineUsers } = useSocket();
  const showToast = useShowToast();

  const [challenges, setChallenges] = useState<CardChallenge[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [showChallengeModal, setShowChallengeModal] = useState(false);

  useEffect(() => {
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!socket) return;

    socket.on('cardChallenge', handleNewChallenge);
    socket.on('acceptCardChallenge', handleChallengeAccepted);
    socket.on('cardDeclined', handleChallengeDeclined);

    return () => {
      socket.off('cardChallenge', handleNewChallenge);
      socket.off('acceptCardChallenge', handleChallengeAccepted);
      socket.off('cardDeclined', handleChallengeDeclined);
    };
  }, [socket]);

  const handleNewChallenge = (data: any) => {
    if (data.to === user?._id) {
      const challenge = {
        _id: `${data.from}_${Date.now()}`,
        challenger: {
          _id: data.from,
          name: data.fromName,
          username: data.fromUsername,
          profilePic: data.fromProfilePic,
        },
        opponent: { _id: user._id },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      setChallenges(prev => [challenge, ...prev]);
      showToast('Card Challenge', `${data.fromName} challenged you!`, 'info');
    }
  };

  const handleChallengeAccepted = (data: any) => {
    // Backend sends: { roomId, opponentId } (similar to chess)
    if (!data?.roomId) return;

    showToast('Challenge Accepted', 'Game started!', 'success');
    navigation.navigate('CardGame', {
      roomId: data.roomId,
      opponentId: data.opponentId,
    });

    // Remove any pending challenge card for that opponent
    if (data.opponentId) {
      setChallenges(prev => prev.filter(c => c.challenger?._id !== data.opponentId));
    }
  };

  const handleChallengeDeclined = (data: any) => {
    // Backend sends: { from } where 'from' is the user who declined
    console.log('🃏 [CardScreen] Challenge declined by:', data.from);
    
    // Remove any pending challenge we sent to this user
    if (data.from) {
      setChallenges(prev => prev.filter(c => {
        // Remove challenges where we are the challenger and the opponent declined
        const isOurChallenge = c.challenger?._id === user?._id && c.opponent?._id === data.from;
        return !isOurChallenge;
      }));
      showToast('Challenge Declined', 'Your challenge was declined', 'info');
    }
  };

  const fetchAvailableUsers = async () => {
    if (!user) return;

    setLoadingUsers(true);
    try {
      const baseUrl = API_URL;
      
      const allConnectionIds = [
        ...(user.following || []),
        ...(user.followers || []),
      ].filter((id) => {
        const idStr = id?.toString().trim();
        if (!idStr || idStr.length !== 24) return false;
        return /^[0-9a-fA-F]{24}$/.test(idStr);
      });

      const uniqueIds = [...new Set(allConnectionIds.map((id) => id.toString()))];

      if (uniqueIds.length === 0) {
        setAvailableUsers([]);
        return;
      }

      const userPromises = uniqueIds.map(async (userId) => {
        try {
          const res = await fetch(`${baseUrl}/api/user/getUserPro/${userId}`, {
            credentials: 'include',
          });
          if (res.ok) {
            const userData = await res.json();
            if (userData && userData._id) {
              return userData;
            }
          }
        } catch (err) {
          console.warn(`⚠️ Error fetching user ${userId}:`, err);
        }
        return null;
      });

      const allUsers = (await Promise.all(userPromises)).filter((u) => u !== null);

      const onlineAvailableUsers = allUsers.filter((u) => {
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

        return isOnline && userIdStr !== currentUserIdStr;
      });

      setAvailableUsers(onlineAvailableUsers);
    } catch (error) {
      console.error('Error fetching available users:', error);
      showToast('Error', 'Failed to fetch users', 'error');
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleCreateChallenge = () => {
    setShowChallengeModal(true);
    fetchAvailableUsers();
  };

  const handleSendChallenge = (opponent: AvailableUser) => {
    if (!socket) {
      showToast('Error', 'Not connected to server', 'error');
      return;
    }

    socket.emit('cardChallenge', {
      from: user?._id,
      to: opponent._id,
      fromName: user?.name,
      fromUsername: user?.username,
      fromProfilePic: user?.profilePic || '',
    });

    showToast('Success', `Challenge sent to ${opponent.name}!`, 'success');
    setShowChallengeModal(false);
  };

  const handleAcceptChallenge = (challenge: CardChallenge) => {
    if (!socket) {
      showToast('Error', 'Not connected to server', 'error');
      return;
    }

    const roomId = `card_${challenge.challenger._id}_${user?._id}_${Date.now()}`;
    
    socket.emit('acceptCardChallenge', {
      from: user?._id,
      to: challenge.challenger._id,
      roomId: roomId,
    });

    setChallenges(prev => prev.filter(c => c._id !== challenge._id));
    navigation.navigate('CardGame', { 
      roomId: roomId,
      opponentId: challenge.challenger._id,
    });
    showToast('Success', 'Challenge accepted!', 'success');
  };

  const handleDeclineChallenge = (challenge: CardChallenge) => {
    if (!socket) {
      showToast('Error', 'Not connected to server', 'error');
      return;
    }

    socket.emit('declineCardChallenge', {
      from: user?._id,
      to: challenge.challenger._id,
    });

    setChallenges(prev => prev.filter(c => c._id !== challenge._id));
    showToast('Info', 'Challenge declined', 'info');
  };

  const renderChallenge = ({ item }: { item: CardChallenge }) => {
    const isReceived = item.opponent._id === user?._id;
    const otherUser = isReceived ? item.challenger : item.opponent;

    return (
      <View style={styles.challengeCard}>
        <View style={styles.challengeInfo}>
          <Text style={styles.challengeText}>
            {isReceived ? `${otherUser.name} challenged you!` : `You challenged ${otherUser.name}`}
          </Text>
          <Text style={styles.challengeTime}>
            {new Date(item.createdAt).toLocaleString()}
          </Text>
        </View>

        {isReceived && (
          <View style={styles.challengeActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.acceptButton]}
              onPress={() => handleAcceptChallenge(item)}
            >
              <Text style={styles.actionButtonText}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.declineButton]}
              onPress={() => handleDeclineChallenge(item)}
            >
              <Text style={styles.actionButtonText}>Decline</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
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
        <Text style={styles.headerTitle}>🃏 Cards</Text>
        <TouchableOpacity style={styles.challengeButton} onPress={handleCreateChallenge}>
          <Text style={styles.challengeButtonText}>+ Challenge</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pending Challenges ({challenges.length})</Text>
        {challenges.length > 0 ? (
          <FlatList
            data={challenges}
            renderItem={renderChallenge}
            keyExtractor={(item) => item._id}
            contentContainerStyle={styles.listContainer}
          />
        ) : (
          <View style={styles.emptySection}>
            <Text style={styles.emptyText}>No pending challenges</Text>
          </View>
        )}
      </View>

      <Modal
        visible={showChallengeModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowChallengeModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Challenge a Friend</Text>
              <TouchableOpacity onPress={() => setShowChallengeModal(false)}>
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
                keyExtractor={(item) => item._id}
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
  challengeButton: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
  },
  challengeButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  section: {
    flex: 1,
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
  },
  listContainer: {
    paddingBottom: 10,
  },
  challengeCard: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  challengeInfo: {
    marginBottom: 12,
  },
  challengeText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 4,
  },
  challengeTime: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  challengeActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginLeft: 8,
  },
  acceptButton: {
    backgroundColor: COLORS.success,
  },
  declineButton: {
    backgroundColor: COLORS.error,
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptySection: {
    padding: 40,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: COLORS.textGray,
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
});

export default CardScreen;
