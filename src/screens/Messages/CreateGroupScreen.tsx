import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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

const FOLLOWING_PAGE_SIZE = 30;

const CreateGroupScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const { colors } = useTheme();
  const { t, tn, language } = useLanguage();

  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [followingUsers, setFollowingUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [loadingMoreUsers, setLoadingMoreUsers] = useState(false);
  const [hasMoreUsers, setHasMoreUsers] = useState(false);
  const cursorRef = useRef<string | null>(null);
  const seenUserIdsRef = useRef<Set<string>>(new Set());
  const hasMoreUsersRef = useRef(false);
  const loadingMoreUsersRef = useRef(false);
  const userHasScrolledListRef = useRef(false);
  const lastLoadMoreAtRef = useRef(0);

  const parseFollowingPageResponse = useCallback((data: any, loadMore: boolean) => {
    // Legacy API (no limit deployed): plain array — show first page only in UI.
    if (Array.isArray(data)) {
      const skip = loadMore ? seenUserIdsRef.current.size : 0;
      const page = data.slice(skip, skip + FOLLOWING_PAGE_SIZE);
      const hasMore = skip + FOLLOWING_PAGE_SIZE < data.length;
      return {
        page,
        nextCursor: hasMore ? String(skip + FOLLOWING_PAGE_SIZE) : null,
        hasMore,
        legacyArray: true,
      };
    }

    const page: any[] = data?.users || [];
    const nextCursor = data?.nextCursor ?? null;
    const hasMore = !!data?.hasMore && !!nextCursor;
    return { page, nextCursor, hasMore, legacyArray: false };
  }, []);

  const fetchFollowingPage = useCallback(async (loadMore: boolean) => {
    if (!user?._id) return;
    if (loadMore) {
      if (!hasMoreUsersRef.current || loadingMoreUsersRef.current || !cursorRef.current) return;
      loadingMoreUsersRef.current = true;
      setLoadingMoreUsers(true);
    } else {
      setLoadingUsers(true);
      cursorRef.current = null;
      seenUserIdsRef.current = new Set();
      hasMoreUsersRef.current = false;
      setHasMoreUsers(false);
      userHasScrolledListRef.current = false;
      lastLoadMoreAtRef.current = 0;
    }

    try {
      const parts = [`limit=${FOLLOWING_PAGE_SIZE}`];
      if (loadMore && cursorRef.current) {
        const c = cursorRef.current;
        if (/^[0-9a-fA-F]{24}$/.test(c)) {
          parts.push(`cursor=${encodeURIComponent(c)}`);
        } else {
          parts.push(`skip=${encodeURIComponent(c)}`);
        }
      }
      const data = await apiService.get(`${ENDPOINTS.GET_FOLLOWING_USERS}?${parts.join('&')}`);
      const { page, nextCursor, hasMore } = parseFollowingPageResponse(data, loadMore);
      cursorRef.current = nextCursor;
      hasMoreUsersRef.current = hasMore;
      setHasMoreUsers(hasMore);

      if (loadMore) {
        setFollowingUsers((prev) => {
          const merged = [...prev];
          for (const u of page) {
            const id = u?._id?.toString?.() ?? String(u._id);
            if (!id || seenUserIdsRef.current.has(id)) continue;
            seenUserIdsRef.current.add(id);
            merged.push(u);
          }
          return merged;
        });
      } else {
        const next: any[] = [];
        const seen = new Set<string>();
        for (const u of page) {
          const id = u?._id?.toString?.() ?? String(u._id);
          if (!id || seen.has(id)) continue;
          seen.add(id);
          next.push(u);
        }
        seenUserIdsRef.current = seen;
        setFollowingUsers(next);
      }
    } catch (e: any) {
      if (!loadMore) setFollowingUsers([]);
      Alert.alert(t('error'), e?.message || t('couldNotLoadFollowingList'));
    } finally {
      loadingMoreUsersRef.current = false;
      if (loadMore) setLoadingMoreUsers(false);
      else setLoadingUsers(false);
    }
  }, [user?._id, t, parseFollowingPageResponse]);

  const handleLoadMoreFollowing = useCallback(() => {
    if (!userHasScrolledListRef.current) return;
    if (Date.now() - lastLoadMoreAtRef.current < 500) return;
    lastLoadMoreAtRef.current = Date.now();
    fetchFollowingPage(true);
  }, [fetchFollowingPage]);

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
        ].map((u) => u.toLowerCase()),
      ),
    [],
  );

  const realUsersOnly = useMemo(() => {
    return (followingUsers || []).filter((u: any) => {
      const username = String(u?.username || '').trim().toLowerCase();
      return username && !EXCLUDED_SYSTEM_USERNAMES.has(username);
    });
  }, [followingUsers, EXCLUDED_SYSTEM_USERNAMES]);

  useEffect(() => {
    fetchFollowingPage(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?._id]);

  useEffect(() => {
    const allowed = new Set(realUsersOnly.map((u: any) => String(u._id)));
    setSelectedIds((prev) => prev.filter((id) => allowed.has(String(id))));
  }, [realUsersOnly]);

  const toggleMember = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
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
          <Text style={[styles.userName, styles.userNameFixedAlign, { color: colors.text }]}>
            {item.name || item.username}
          </Text>
          {item.username && item.name !== item.username && (
            <Text style={[styles.userHandle, styles.userNameFixedAlign, { color: colors.textGray }]}>
              @{item.username}
            </Text>
          )}
        </View>
        <View
          style={[
            styles.checkbox,
            {
              borderColor: selected ? colors.primary : colors.border,
              backgroundColor: selected ? colors.primary : 'transparent',
            },
          ]}
        >
          {selected && <Text style={styles.checkMark}>✓</Text>}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <StatusBar barStyle="light-content" />

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
                { color: !groupName.trim() || selectedIds.length === 0 ? colors.textGray : colors.primary },
              ]}
            >
              {t('create')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

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

      {loadingUsers ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : realUsersOnly.length === 0 ? (
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
          keyExtractor={(item) => item._id?.toString?.() ?? String(item._id)}
          renderItem={renderUser}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => {
            userHasScrolledListRef.current = true;
          }}
          onMomentumScrollBegin={() => {
            userHasScrolledListRef.current = true;
          }}
          onEndReached={handleLoadMoreFollowing}
          onEndReachedThreshold={0.35}
          ListFooterComponent={
            loadingMoreUsers ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : hasMoreUsers ? (
              <Text style={[styles.loadMoreHint, { color: colors.textGray }]}>
                {t('scrollForMore') !== 'scrollForMore' ? t('scrollForMore') : 'Scroll for more…'}
              </Text>
            ) : null
          }
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
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  footerLoading: { paddingVertical: 16, alignItems: 'center' },
  loadMoreHint: { paddingVertical: 14, textAlign: 'center', fontSize: 13 },
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
