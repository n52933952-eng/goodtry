import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  Alert,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  TextInput,
  Modal,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { useLanguage } from '../../context/LanguageContext';
import { useSocket } from '../../context/SocketContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const idStr = (v: any): string => {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v._id) return String(v._id);
  return String(v);
};

const GroupInfoScreen = ({ route, navigation }: any) => {
  const { conversation: initialConversation } = route.params || {};
  const { user } = useUser();
  const { colors } = useTheme();
  const { t, tn } = useLanguage();
  const { socket } = useSocket();

  const [conversation, setConversation] = useState<any>(initialConversation || {});
  const [leaving, setLeaving] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  // Real-time group updates
  useEffect(() => {
    if (!socket) return;
    const convId = idStr(conversation._id);

    const onMemberLeft = ({ conversationId, userId: leftId, newAdmin }: any) => {
      if (idStr(conversationId) !== convId) return;
      setConversation((prev: any) => {
        const updatedParticipants = (prev.participants || []).filter(
          (p: any) => idStr(p._id || p) !== idStr(leftId)
        );
        return {
          ...prev,
          participants: updatedParticipants,
          admin: newAdmin ? newAdmin : prev.admin,
        };
      });
    };

    const onGroupDeleted = ({ conversationId }: any) => {
      if (idStr(conversationId) !== convId) return;
      Alert.alert(t('groupDeletedTitle') || 'Group Deleted', t('groupDeletedByAdmin') || 'This group has been deleted.');
      navigation.pop(2);
    };

    const onMemberAdded = ({ conversationId, conversation: updatedConv }: any) => {
      if (idStr(conversationId) !== convId) return;
      if (updatedConv) setConversation(updatedConv);
    };

    socket.on('groupMemberLeft', onMemberLeft);
    socket.on('groupDeleted', onGroupDeleted);
    socket.on('groupMemberAdded', onMemberAdded);

    return () => {
      socket.off('groupMemberLeft', onMemberLeft);
      socket.off('groupDeleted', onGroupDeleted);
      socket.off('groupMemberAdded', onMemberAdded);
    };
  }, [socket, conversation._id, navigation, t]);

  // Edit group name
  const [editNameVisible, setEditNameVisible] = useState(false);
  const [editNameValue, setEditNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Add members
  const [addMembersVisible, setAddMembersVisible] = useState(false);
  const [followingUsers, setFollowingUsers] = useState<any[]>([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [addingMemberId, setAddingMemberId] = useState<string | null>(null);

  const myId = idStr(user?._id);
  const adminId = idStr(conversation.admin?._id || conversation.admin);
  const iAmAdmin = myId && adminId && myId === adminId;

  const currentParticipantIds = new Set(
    (conversation.participants || []).map((p: any) => idStr(p._id || p))
  );

  const fetchFollowingUsers = useCallback(async () => {
    setLoadingFollowing(true);
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_FOLLOWING_USERS}/${myId}`);
      const list = Array.isArray(data) ? data : data?.following || [];
      setFollowingUsers(list);
    } catch (_) {
      Alert.alert(t('error'), t('couldNotLoadFollowingList'));
    } finally {
      setLoadingFollowing(false);
    }
  }, [myId, t]);

  const handleOpenAddMembers = useCallback(() => {
    setAddMembersVisible(true);
    fetchFollowingUsers();
  }, [fetchFollowingUsers]);

  const handleAddMember = useCallback(async (newUserId: string) => {
    setAddingMemberId(newUserId);
    try {
      const updated = await apiService.post(
        `${ENDPOINTS.ADD_GROUP_MEMBER}/${conversation._id}/members`,
        { userId: newUserId }
      );
      setConversation(updated);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to add member');
    } finally {
      setAddingMemberId(null);
    }
  }, [conversation._id]);

  const handleSaveGroupName = useCallback(async () => {
    const trimmed = editNameValue.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const updated = await apiService.put(
        `${ENDPOINTS.UPDATE_GROUP_INFO}/${conversation._id}`,
        { groupName: trimmed }
      );
      setConversation((prev: any) => ({ ...prev, groupName: updated.groupName || trimmed }));
      setEditNameVisible(false);
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to update group name');
    } finally {
      setSavingName(false);
    }
  }, [conversation._id, editNameValue]);

  const handleLeave = useCallback(() => {
    Alert.alert(
      t('leaveGroup'),
      tn('leaveGroupConfirm', { name: conversation.groupName || 'group' }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await apiService.post(`${ENDPOINTS.LEAVE_GROUP}/${conversation._id}/leave`, {});
              // Pop back to messages list
              navigation.pop(2);
            } catch (e: any) {
              Alert.alert(t('error'), e?.message || t('failedToLeaveGroup'));
            } finally {
              setLeaving(false);
            }
          },
        },
      ]
    );
  }, [conversation._id, conversation.groupName, navigation, t, tn]);

  const handleDeleteGroup = useCallback(() => {
    Alert.alert(
      t('deleteGroup'),
      tn('deleteGroupConfirm', { name: conversation.groupName || 'group' }),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setDeletingGroup(true);
            try {
              await apiService.delete(`${ENDPOINTS.DELETE_GROUP}/${conversation._id}`);
              navigation.pop(2);
            } catch (e: any) {
              Alert.alert(t('error'), e?.message || t('failedToDeleteGroup'));
            } finally {
              setDeletingGroup(false);
            }
          },
        },
      ]
    );
  }, [conversation._id, conversation.groupName, navigation, t, tn]);

  const handleRemoveMember = useCallback(
    (memberId: string, memberName: string) => {
      Alert.alert(
        t('removeMember'),
        tn('removeMemberConfirm', { name: memberName }),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: async () => {
              setRemovingId(memberId);
              try {
                await apiService.delete(
                  `${ENDPOINTS.REMOVE_GROUP_MEMBER}/${conversation._id}/members/${memberId}`
                );
                setConversation((prev: any) => ({
                  ...prev,
                  participants: (prev.participants || []).filter(
                    (p: any) => idStr(p._id || p) !== memberId
                  ),
                }));
              } catch (e: any) {
                Alert.alert(t('error'), e?.message || t('failedToRemoveMember'));
              } finally {
                setRemovingId(null);
              }
            },
          },
        ]
      );
    },
    [conversation._id, t, tn]
  );

  const participants: any[] = conversation.participants || [];

  const renderMember = ({ item }: { item: any }) => {
    const pid = idStr(item._id || item);
    const isMe = pid === myId;
    const isAdmin = pid === adminId;

    return (
      <View style={[styles.memberRow, { borderBottomColor: colors.border }]}>
        {/* Avatar */}
        {item.profilePic ? (
          <Image source={{ uri: item.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
            <Text style={styles.avatarText}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
          </View>
        )}

        {/* Name + badges */}
        <View style={styles.memberInfo}>
          <View style={styles.nameRow}>
            <Text style={[styles.memberName, { color: colors.text }]}>
              {item.name || item.username || 'User'}
            </Text>
            {isAdmin && (
              <View style={[styles.badge, { backgroundColor: '#f59e0b' }]}>
                <Text style={styles.badgeText}>{t('admin')}</Text>
              </View>
            )}
            {isMe && (
              <View style={[styles.badge, { backgroundColor: colors.border }]}>
                <Text style={[styles.badgeText, { color: colors.textGray }]}>{t('you')}</Text>
              </View>
            )}
          </View>
          {item.username && item.name !== item.username && (
            <Text style={[styles.memberHandle, { color: colors.textGray }]}>@{item.username}</Text>
          )}
        </View>

        {/* Admin remove button */}
        {iAmAdmin && !isMe && (
          <TouchableOpacity
            onPress={() => handleRemoveMember(pid, item.name || item.username || t('unknown'))}
            disabled={removingId === pid}
            style={styles.removeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {removingId === pid ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={{ fontSize: 18 }}>✕</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: colors.primary }]}>{`← ${t('back')}`}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('groupInfo')}</Text>
        <View style={{ minWidth: 60 }} />
      </View>

      {/* Group avatar + name */}
      <View style={[styles.groupBanner, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
        <View style={[styles.groupIcon, { backgroundColor: '#1a4a8a' }]}>
          <Text style={styles.groupIconText}>👥</Text>
        </View>
        <View style={styles.groupNameRow}>
          <Text style={[styles.groupName, { color: colors.text }]}>
            {conversation.groupName || 'Group'}
          </Text>
          {iAmAdmin && (
            <TouchableOpacity
              onPress={() => { setEditNameValue(conversation.groupName || ''); setEditNameVisible(true); }}
              style={[styles.editNameBtn, { backgroundColor: colors.border }]}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={{ fontSize: 13, color: colors.primary }}>{`✏️ ${t('edit')}`}</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={[styles.memberCount, { color: colors.textGray }]}>
          {participants.length} {t('members')}
        </Text>
      </View>

      {/* Members list */}
      <Text style={[styles.sectionHeader, { color: colors.textGray, backgroundColor: colors.background }]}>
        {t('members').toUpperCase()}
      </Text>
      <FlatList
        data={participants}
        keyExtractor={(item, i) => idStr(item._id || item) || String(i)}
        renderItem={renderMember}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          <View style={styles.footerSection}>
            {iAmAdmin && (
              <TouchableOpacity
                style={[styles.addMembersBtn, { backgroundColor: colors.primary }]}
                onPress={handleOpenAddMembers}
              >
                <Text style={styles.addMembersBtnText}>{`➕ ${t('addMembers')}`}</Text>
              </TouchableOpacity>
            )}
            {!iAmAdmin && (
              <TouchableOpacity
                style={[styles.leaveBtn, { borderColor: colors.error }]}
                onPress={handleLeave}
                disabled={leaving}
              >
                {leaving ? (
                  <ActivityIndicator size="small" color={colors.error} />
                ) : (
                  <Text style={[styles.leaveBtnText, { color: colors.error }]}>{`🚪 ${t('leaveGroup')}`}</Text>
                )}
              </TouchableOpacity>
            )}
            {iAmAdmin && (
              <TouchableOpacity
                style={[styles.deleteGroupBtn]}
                onPress={handleDeleteGroup}
                disabled={deletingGroup}
              >
                {deletingGroup ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.deleteGroupBtnText}>{`🗑️ ${t('deleteGroup')}`}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        }
      />
      {/* Edit group name modal */}
      <Modal visible={editNameVisible} transparent animationType="fade" onRequestClose={() => setEditNameVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.backgroundLight }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>{t('editGroupName')}</Text>
            <TextInput
              style={[styles.modalInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              value={editNameValue}
              onChangeText={setEditNameValue}
              placeholder={t('groupNamePlaceholder')}
              placeholderTextColor={colors.textGray}
              maxLength={50}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setEditNameVisible(false)} style={styles.modalCancelBtn}>
                <Text style={[styles.modalCancelText, { color: colors.textGray }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveGroupName}
                disabled={savingName || !editNameValue.trim()}
                style={[styles.modalSaveBtn, { backgroundColor: colors.primary, opacity: (!editNameValue.trim() || savingName) ? 0.5 : 1 }]}
              >
                {savingName ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalSaveText}>{t('save')}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Add members modal */}
      <Modal visible={addMembersVisible} transparent animationType="slide" onRequestClose={() => setAddMembersVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.addMembersBox, { backgroundColor: colors.backgroundLight }]}>
            <View style={[styles.addMembersHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>{t('addMembers')}</Text>
              <TouchableOpacity onPress={() => setAddMembersVisible(false)}>
                <Text style={{ fontSize: 20, color: colors.textGray }}>✕</Text>
              </TouchableOpacity>
            </View>
            {loadingFollowing ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 32 }} />
            ) : followingUsers.length === 0 ? (
              <Text style={[styles.emptyFollowing, { color: colors.textGray }]}>{t('noOneToAddFromFollowing')}</Text>
            ) : (
              <FlatList
                data={followingUsers.filter((u: any) => !currentParticipantIds.has(idStr(u._id || u)))}
                keyExtractor={(item) => idStr(item._id || item)}
                renderItem={({ item }) => {
                  const uid = idStr(item._id || item);
                  const adding = addingMemberId === uid;
                  const alreadyIn = currentParticipantIds.has(uid);
                  return (
                    <View style={[styles.followingRow, { borderBottomColor: colors.border }]}>
                      {item.profilePic ? (
                        <Image source={{ uri: item.profilePic }} style={styles.followingAvatar} />
                      ) : (
                        <View style={[styles.followingAvatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                          <Text style={styles.avatarText}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
                        </View>
                      )}
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[{ fontSize: 15, fontWeight: '600' }, { color: colors.text }]}>{item.name || item.username}</Text>
                        {item.username && item.name !== item.username && (
                          <Text style={[{ fontSize: 13 }, { color: colors.textGray }]}>@{item.username}</Text>
                        )}
                      </View>
                      {alreadyIn ? (
                        <Text style={[{ fontSize: 12 }, { color: colors.textGray }]}>{t('alreadyIn')}</Text>
                      ) : (
                        <TouchableOpacity
                          onPress={() => handleAddMember(uid)}
                          disabled={adding}
                          style={[styles.addBtn, { backgroundColor: colors.primary }]}
                        >
                          {adding ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addBtnText}>{t('addMember')}</Text>}
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                }}
                ListEmptyComponent={<Text style={[styles.emptyFollowing, { color: colors.textGray }]}>{t('everyoneAlreadyInGroup')}</Text>}
              />
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { minWidth: 60 },
  backText: { fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  groupBanner: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  groupIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  groupIconText: { fontSize: 36 },
  groupName: { fontSize: 20, fontWeight: '700', marginBottom: 4 },
  memberCount: { fontSize: 14 },
  sectionHeader: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  memberInfo: { flex: 1, marginLeft: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  memberName: { fontSize: 15, fontWeight: '600' },
  memberHandle: { fontSize: 13, marginTop: 1 },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#fff' },
  removeBtn: { padding: 4 },
  footerSection: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 12,
  },
  leaveBtn: {
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  leaveBtnText: { fontSize: 16, fontWeight: '600' },
  deleteGroupBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#dc2626',
  },
  deleteGroupBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  groupNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  editNameBtn: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  addMembersBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  addMembersBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalBox: {
    width: '100%',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', marginBottom: 14 },
  modalInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  modalCancelBtn: { paddingHorizontal: 14, paddingVertical: 10 },
  modalCancelText: { fontSize: 15 },
  modalSaveBtn: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10, minWidth: 70, alignItems: 'center' },
  modalSaveText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  // Add members modal
  addMembersBox: {
    width: '100%',
    borderRadius: 16,
    maxHeight: '80%',
    paddingBottom: 20,
  },
  addMembersHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  followingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  followingAvatar: { width: 42, height: 42, borderRadius: 21 },
  addBtn: { borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7, minWidth: 50, alignItems: 'center' },
  addBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  emptyFollowing: { textAlign: 'center', fontSize: 14, padding: 32 },
});

export default GroupInfoScreen;
