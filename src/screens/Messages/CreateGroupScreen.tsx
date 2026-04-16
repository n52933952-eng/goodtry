import React, { useState, useCallback, useMemo, useEffect } from 'react';
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
import { useLanguage } from '../../context/LanguageContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const CreateGroupScreen = ({ route, navigation }: any) => {
  const { followingUsers = [] } = route.params || {};
  const { user } = useUser();
  const { colors } = useTheme();
  const { t, tn, language } = useLanguage();

  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const EXCLUDED_SYSTEM_USERNAMES = useMemo(
    () =>
      new Set(
        [
          'Football',
          'Weather',
          'AlJazeera',
          'NBCNews',
          'BeinSportsNews',
          'SkyNews',
          'Cartoonito',
          'NatGeoKids',
          'SciShowKids',
          'JJAnimalTime',
          'KidsArabic',
          'NatGeoAnimals',
          'MBCDrama',
          'Fox11',
        ].map((u) => u.toLowerCase())
      ),
    []
  );

  const realUsersOnly = useMemo(() => {
    return (followingUsers || []).filter((u: any) => {
      const username = String(u?.username || '').trim().toLowerCase();
      return username && !EXCLUDED_SYSTEM_USERNAMES.has(username);
    });
  }, [followingUsers, EXCLUDED_SYSTEM_USERNAMES]);

  useEffect(() => {
    // Keep selection valid if list updates (e.g. user had selected a system account before filter).
    const allowed = new Set(realUsersOnly.map((u: any) => String(u._id)));
    setSelectedIds((prev) => prev.filter((id) => allowed.has(String(id))));
  }, [realUsersOnly]);

  const toggleMember = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const handleCreate = async () => {
    if (!groupName.trim()) {
      Alert.alert(t('error'), t('pleaseEnterGroupName'));
      return;
    }
    if (selectedIds.length === 0) {
      Alert.alert(t('error'), t('selectAtLeastOneMember'));
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
      Alert.alert(t('error'), e?.message || t('failedToCreateGroup'));
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
          <Text style={[styles.userName, styles.userNameFixedAlign, { color: colors.text }]}>{item.name || item.username}</Text>
          {item.username && item.name !== item.username && (
            <Text style={[styles.userHandle, styles.userNameFixedAlign, { color: colors.textGray }]}>@{item.username}</Text>
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
          <Text style={[styles.cancelText, { color: colors.textGray }]}>{t('cancel')}</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('newGroup')}</Text>
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
              {t('create')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Group Name Input */}
      <View style={[styles.nameSection, { borderBottomColor: colors.border, backgroundColor: colors.backgroundLight }]}>
        <Text style={[styles.sectionLabel, { color: colors.textGray }]}>{t('groupNameLabel')}</Text>
        <TextInput
          style={[styles.nameInput, { color: colors.text }]}
          placeholder={t('enterGroupName')}
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
            ? tn('membersSelected', {
                count: selectedIds.length,
                suffix: language === 'en' ? (selectedIds.length > 1 ? 's' : '') : '',
              })
            : t('selectMembersFromFollowing')}
        </Text>
      </View>

      {/* Following Users List */}
      {realUsersOnly.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={[styles.emptyText, { color: colors.text }]}>👥</Text>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('noFollowingUsers')}</Text>
          <Text style={[styles.emptySubtitle, { color: colors.textGray }]}>
            {t('followPeopleToAddGroup')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={realUsersOnly}
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
  userNameFixedAlign: {
    textAlign: 'left',
  },
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
