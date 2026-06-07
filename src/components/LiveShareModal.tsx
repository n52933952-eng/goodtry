/**
 * Share a live stream to users you follow — avatar, username, tap to send.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { buildLiveShareMessage, LiveSharePayload } from '../utils/liveShareMessage';
import { useShowToast } from '../hooks/useShowToast';
import UserListSearchBar from './UserListSearchBar';
import { filterUsersByQuery } from '../utils/filterUsersByQuery';

type Props = {
  visible: boolean;
  onClose: () => void;
  live: LiveSharePayload | null;
};

const LiveShareModal: React.FC<Props> = ({ visible, onClose, live }) => {
  const { colors } = useTheme();
  const showToast = useShowToast();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sendingToId, setSendingToId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = useMemo(
    () => filterUsersByQuery(users, searchQuery),
    [users, searchQuery],
  );

  const fetchFollowing = useCallback(async () => {
    setLoading(true);
    try {
      const data: any = await apiService.get(ENDPOINTS.GET_FOLLOWING_USERS);
      const list = Array.isArray(data) ? data : (data?.users || []);
      setUsers(list);
    } catch {
      setUsers([]);
      showToast('Error', 'Could not load people you follow', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (visible) {
      setSearchQuery('');
      fetchFollowing();
    }
  }, [visible, fetchFollowing]);

  const sendToUser = async (followUser: any) => {
    if (!live?.streamerId || sendingToId) return;
    const recipientId = String(followUser?._id || '');
    if (!recipientId) return;

    setSendingToId(recipientId);
    try {
      await apiService.post(ENDPOINTS.SEND_MESSAGE, {
        recipientId,
        message: buildLiveShareMessage(live),
      });
      const label = followUser?.name || followUser?.username || 'user';
      showToast('Sent', `Live shared with ${label}`, 'success');
      onClose();
    } catch {
      showToast('Error', 'Could not send live', 'error');
    } finally {
      setSendingToId(null);
    }
  };

  const renderUser = ({ item }: { item: any }) => {
    const name = item?.name || item?.username || 'User';
    const username = item?.username ? `@${item.username}` : '';
    const busy = sendingToId === String(item?._id || '');

    return (
      <TouchableOpacity
        style={[styles.row, styles.rowLtr, { borderColor: colors.border }]}
        onPress={() => sendToUser(item)}
        disabled={!!sendingToId}
        activeOpacity={0.85}
      >
        {item?.profilePic ? (
          <Image source={{ uri: item.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarLetter, { color: colors.textGray }]}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={[styles.name, styles.nameLtr, { color: colors.text }]} numberOfLines={1}>
            {name}
          </Text>
          {!!username && (
            <Text style={[styles.username, styles.nameLtr, { color: colors.textGray }]} numberOfLines={1}>
              {username}
            </Text>
          )}
        </View>
        {busy ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Text style={[styles.sendLabel, { color: colors.primary }]}>Send</Text>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.text }]}>Share live</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.closeText, { color: colors.textGray }]}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.sub, { color: colors.textGray }]}>
            Tap someone you follow to send them the live
          </Text>

          <UserListSearchBar
            value={searchQuery}
            onChangeText={setSearchQuery}
            containerStyle={styles.searchBar}
          />

          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            <FlatList
              data={filteredUsers}
              keyExtractor={(item, idx) => String(item?._id || `u-${idx}`)}
              style={{ maxHeight: 320 }}
              keyboardShouldPersistTaps="handled"
              renderItem={renderUser}
              ListEmptyComponent={
                <Text style={[styles.sub, { color: colors.textGray, textAlign: 'center', marginTop: 12 }]}>
                  {searchQuery.trim() ? 'No users found' : 'No users to share with yet'}
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: { fontSize: 18, fontWeight: '700' },
  closeBtn: { padding: 4 },
  closeText: { fontSize: 20, fontWeight: '600' },
  sub: { fontSize: 13, marginBottom: 8 },
  searchBar: { marginBottom: 10 },
  loadingWrap: { paddingVertical: 28, alignItems: 'center' },
  /** Keep rows LTR so Arabic names sit after the avatar (same as English), not beside Send. */
  rowLtr: { direction: 'ltr' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 44, height: 44, borderRadius: 22 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { fontWeight: '700' },
  rowText: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  name: { fontSize: 15, fontWeight: '600' },
  /** Full width + LTR text so mixed Arabic/Latin usernames align consistently */
  nameLtr: {
    alignSelf: 'stretch',
    textAlign: 'left',
    width: '100%',
    writingDirection: 'ltr',
  },
  username: { fontSize: 12, marginTop: 1 },
  sendLabel: { fontSize: 14, fontWeight: '700' },
});

export default LiveShareModal;
