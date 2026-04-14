import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const CreateGroupScreen = ({ route, navigation }: any) => {
  const { followingUsers = [] } = route.params || {};
  const { user } = useUser();
  const { colors } = useTheme();

  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const toggleMember = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const handleCreate = async () => {
    if (!groupName.trim()) {
      Alert.alert('Error', 'Please enter a group name');
      return;
    }
    if (selectedIds.length === 0) {
      Alert.alert('Error', 'Select at least one member');
      return;
    }

    setCreating(true);
    try {
      const data = await apiService.post(ENDPOINTS.CREATE_GROUP, {
        groupName: groupName.trim(),
        participantIds: selectedIds,
      });

      // Navigate to the new group chat
      navigation.replace('ChatScreen', {
        conversationId: data._id,
        isGroup: true,
        groupName: data.groupName,
        conversation: data,
      });
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  const renderUser = ({ item }: { item: any }) => {
    const selected = selectedIds.includes(item._id);
    return (
      <TouchableOpacity
        style={[
          styles.userRow,
          { borderBottomColor: colors.border },
          selected && { backgroundColor: colors.backgroundLight },
        ]}
        onPress={() => toggleMember(item._id)}
        activeOpacity={0.7}
      >
        {item.profilePic ? (
          <Image source={{ uri: item.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
            <Text style={styles.avatarText}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <Text style={[styles.userName, { color: colors.text }]}>{item.name || item.username}</Text>
          {item.username && item.name !== item.username && (
            <Text style={[styles.userHandle, { color: colors.textGray }]}>@{item.username}</Text>
          )}
        </View>
        <View style={[styles.checkbox, { borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : 'transparent' }]}>
          {selected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" />

      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.cancelBtn}>
          <Text style={[styles.cancelText, { color: colors.textGray }]}>Cancel</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>New Group</Text>
        <TouchableOpacity
          onPress={handleCreate}
          disabled={creating || !groupName.trim() || selectedIds.length === 0}
          style={styles.createBtn}
        >
          {creating ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text
              style={[
                styles.createText,
                { color: (!groupName.trim() || selectedIds.length === 0) ? colors.textGray : colors.primary },
              ]}
            >
              Create
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Group Name Input */}
      <View style={[styles.nameSection, { borderBottomColor: colors.border, backgroundColor: colors.backgroundLight }]}>
        <Text style={[styles.sectionLabel, { color: colors.textGray }]}>GROUP NAME</Text>
        <TextInput
          style={[styles.nameInput, { color: colors.text }]}
          placeholder="Enter group name..."
          placeholderTextColor={colors.textGray}
          value={groupName}
          onChangeText={setGroupName}
          maxLength={50}
          autoFocus
          returnKeyType="done"
        />
      </View>

      {/* Selected Count */}
      <View style={[styles.countRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.countText, { color: colors.textGray }]}>
          {selectedIds.length > 0
            ? `${selectedIds.length} member${selectedIds.length > 1 ? 's' : ''} selected`
            : 'Select members from your following list'}
        </Text>
      </View>

      {/* Following Users List */}
      {followingUsers.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.text }]}>👥</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>No following users</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textGray }]}>
            Follow people to add them to a group
          </Text>
        </View>
      ) : (
        <FlatList
          data={followingUsers}
          keyExtractor={(item) => item._id}
          renderItem={renderUser}
          showsVerticalScrollIndicator={false}
        />
      )}
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
  cancelBtn: { minWidth: 60 },
  cancelText: { fontSize: 16 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  createBtn: { minWidth: 60, alignItems: 'flex-end' },
  createText: { fontSize: 16, fontWeight: '600' },
  nameSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  nameInput: {
    fontSize: 16,
    paddingVertical: 4,
  },
  countRow: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  countText: { fontSize: 13 },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: { width: 46, height: 46, borderRadius: 23 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  userInfo: { flex: 1, marginLeft: 12 },
  userName: { fontSize: 15, fontWeight: '600' },
  userHandle: { fontSize: 13, marginTop: 1 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkMark: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  emptyText: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  emptySubtitle: { fontSize: 14, textAlign: 'center' },
});

export default CreateGroupScreen;
