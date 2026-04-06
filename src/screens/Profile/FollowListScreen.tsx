import React, { useState, useCallback, useLayoutEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Image,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';
import { useLanguage } from '../../context/LanguageContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';

const PAGE_SIZE = 12;

type ListMode = 'following' | 'followers';

interface FollowListScreenProps {
  navigation: any;
  route: {
    params: {
      listType: ListMode;
      /** When set, load this user's list (otherwise the logged-in user). */
      userId?: string;
      /** For header: @username */
      displayUsername?: string;
    };
  };
}

function normalizeFollowListResponse(data: any): {
  users: any[];
  hasMore: boolean;
  nextSkip: number;
} {
  if (data && typeof data === 'object' && Array.isArray(data.users)) {
    return {
      users: data.users,
      hasMore: !!data.hasMore,
      nextSkip: typeof data.nextSkip === 'number' ? data.nextSkip : data.users.length,
    };
  }
  if (Array.isArray(data)) {
    return { users: data, hasMore: false, nextSkip: data.length };
  }
  return { users: [], hasMore: false, nextSkip: 0 };
}

const FollowListScreen: React.FC<FollowListScreenProps> = ({ navigation, route }) => {
  const listType = route.params?.listType ?? 'following';
  const targetUserId =
    route.params?.userId != null && String(route.params.userId).trim() !== ''
      ? String(route.params.userId)
      : null;
  const displayUsername = route.params?.displayUsername;
  const { colors } = useTheme();
  const { user: currentUser, updateUser } = useUser();
  const { t, tn } = useLanguage();
  const showToast = useShowToast();

  const isOwnList =
    !targetUserId || (currentUser?._id != null && String(currentUser._id) === targetUserId);

  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const nextSkipRef = useRef(0);
  const [actingId, setActingId] = useState<string | null>(null);

  const listPath =
    listType === 'following' ? ENDPOINTS.GET_FOLLOWING_USERS : ENDPOINTS.GET_FOLLOWERS_USERS;

  const fetchPage = useCallback(
    async (skip: number, mode: 'replace' | 'append') => {
      // Manual query string — avoid URLSearchParams (not fully implemented in some RN/Hermes builds).
      const parts = [`limit=${PAGE_SIZE}`, `skip=${skip}`];
      if (targetUserId) parts.push(`userId=${encodeURIComponent(targetUserId)}`);
      const data = await apiService.get(`${listPath}?${parts.join('&')}`);
      const { users: page, hasMore: more, nextSkip } = normalizeFollowListResponse(data);

      if (mode === 'replace') {
        setUsers(page);
      } else {
        setUsers((prev) => {
          const seen = new Set(prev.map((u) => String(u._id ?? u.username ?? '')));
          const merged = [...prev];
          for (const u of page) {
            const id = String(u._id ?? '');
            if (id && !seen.has(id)) {
              seen.add(id);
              merged.push(u);
            }
          }
          return merged;
        });
      }
      setHasMore(more);
      nextSkipRef.current = nextSkip;
      return { page, hasMore: more, nextSkip };
    },
    [listPath, targetUserId]
  );

  useLayoutEffect(() => {
    const baseTitle = listType === 'following' ? t('following') : t('followers');
    const title =
      displayUsername && targetUserId && !isOwnList ? `@${displayUsername} · ${baseTitle}` : baseTitle;
    navigation.setOptions({
      headerShown: true,
      title,
      headerTitleAlign: 'center',
      headerStyle: { backgroundColor: colors.backgroundLight },
      headerTintColor: colors.text,
      headerTitleStyle: { color: colors.text, fontWeight: '700' as const, fontSize: 18 },
      headerRight: () => <View style={{ width: 44 }} />,
    });
  }, [navigation, listType, t, colors.backgroundLight, colors.text, displayUsername, targetUserId, isOwnList]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      nextSkipRef.current = 0;
      setHasMore(true);
      setUsers([]);
      setLoading(true);
      (async () => {
        try {
          await fetchPage(0, 'replace');
        } catch (e: any) {
          if (!cancelled) {
            showToast(t('error'), e?.message || t('failedToLoadList'), 'error');
            setUsers([]);
            setHasMore(false);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [fetchPage, showToast, t, targetUserId, listType])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    nextSkipRef.current = 0;
    setHasMore(true);
    try {
      await fetchPage(0, 'replace');
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToLoadList'), 'error');
    } finally {
      setRefreshing(false);
    }
  }, [fetchPage, showToast, t]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      await fetchPage(nextSkipRef.current, 'append');
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToLoadList'), 'error');
    } finally {
      setLoadingMore(false);
    }
  }, [fetchPage, hasMore, loading, loadingMore, showToast, t]);

  const syncFollowingContext = (removedUserId: string) => {
    if (!currentUser) return;
    const next = (currentUser.following || []).filter(
      (id: any) => id?.toString() !== removedUserId
    );
    updateUser({ following: next as any });
  };

  const syncFollowersContext = (removedFollowerId: string) => {
    if (!currentUser) return;
    const next = (currentUser.followers || []).filter(
      (id: any) => id?.toString() !== removedFollowerId
    );
    updateUser({ followers: next as any });
  };

  const handleUnfollow = (item: any) => {
    const uid = item._id?.toString();
    if (!uid) return;
    const label = item.name || `@${item.username}` || '?';
    Alert.alert(t('unfollow'), tn('confirmUnfollowUser', { name: label }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('unfollow'),
        style: 'destructive',
        onPress: async () => {
          setActingId(uid);
          try {
            await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${uid}`);
            syncFollowingContext(uid);
            setUsers((prev) => prev.filter((u) => u._id?.toString() !== uid));
            showToast(t('success'), t('unfollowed'), 'success');
          } catch (e: any) {
            showToast(t('error'), e?.message || t('failedToFollowUnfollow'), 'error');
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  };

  const handleRemoveFollower = (item: any) => {
    const uid = item._id?.toString();
    if (!uid) return;
    const label = item.name || `@${item.username}` || '?';
    Alert.alert(t('removeFollowerTitle'), tn('removeFollowerMessage', { name: label }), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('remove'),
        style: 'destructive',
        onPress: async () => {
          setActingId(uid);
          try {
            const res = await apiService.delete(`${ENDPOINTS.REMOVE_FOLLOWER}/${uid}`);
            if (res?.current && Array.isArray(res.current.followers)) {
              const nextFollowers = (res.current.followers || []).map((x: any) =>
                x?.toString?.() != null ? x.toString() : String(x)
              );
              updateUser({ followers: nextFollowers as any });
            } else {
              syncFollowersContext(uid);
            }
            setUsers((prev) => prev.filter((u) => u._id?.toString() !== uid));
            showToast(t('success'), t('followerRemoved'), 'success');
          } catch (e: any) {
            showToast(t('error'), e?.message || t('failedToRemoveFollower'), 'error');
          } finally {
            setActingId(null);
          }
        },
      },
    ]);
  };

  const openProfile = (item: any) => {
    const uname = item.username;
    if (!uname) return;
    navigation.navigate('UserProfile', { username: uname });
  };

  const renderItem = ({ item }: { item: any }) => {
    const uid = item._id?.toString();
    const busy = actingId === uid;
    return (
      <View
        style={[
          styles.row,
          styles.rowLtr,
          {
            backgroundColor: colors.backgroundLight,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: colors.border,
          },
        ]}
      >
        <TouchableOpacity
          style={[styles.rowMain, styles.rowLtr]}
          onPress={() => openProfile(item)}
          activeOpacity={0.7}
        >
          {item.profilePic ? (
            <Image source={{ uri: item.profilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[styles.avatarLetter, { color: colors.text }]}>
                {(item.name || item.username || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.rowText}>
            <Text style={[styles.name, styles.nameLtr, { color: colors.text }]} numberOfLines={1}>
              {item.name || t('unknown')}
            </Text>
            <Text style={[styles.username, styles.nameLtr, { color: colors.textGray }]} numberOfLines={1}>
              @{item.username}
            </Text>
          </View>
        </TouchableOpacity>
        {isOwnList && listType === 'following' ? (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.border }]}
            onPress={() => handleUnfollow(item)}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={[styles.actionBtnText, { color: colors.text }]}>{t('unfollow')}</Text>
            )}
          </TouchableOpacity>
        ) : isOwnList && listType === 'followers' ? (
          <TouchableOpacity
            style={[styles.actionBtn, { borderColor: colors.error }]}
            onPress={() => handleRemoveFollower(item)}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.error} />
            ) : (
              <Text style={[styles.actionBtnText, { color: colors.error }]}>{t('remove')}</Text>
            )}
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  const listFooter =
    loadingMore && users.length > 0 ? (
      <View style={styles.footerLoading}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    ) : null;

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={[styles.container, styles.rowLtr, { backgroundColor: colors.background }]}>
      <FlatList
        data={users}
        keyExtractor={(item) => item._id?.toString() || String(item.username)}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.35}
        ListFooterComponent={listFooter}
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.textGray }]}>
            {listType === 'following' ? t('noFollowingYet') : t('noFollowersYet')}
          </Text>
        }
        contentContainerStyle={
          users.length === 0
            ? styles.emptyContainer
            : [styles.listContent, { paddingTop: 14, backgroundColor: colors.background }]
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  /** Keep list rows LTR so Arabic names sit after the avatar (same as English), not beside the action button. */
  rowLtr: { direction: 'ltr' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  footerLoading: { paddingVertical: 16, alignItems: 'center' },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
    borderRadius: 12,
  },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '700' },
  rowText: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  name: { fontSize: 16, fontWeight: '600' },
  /** Full width + LTR text so mixed Arabic/Latin usernames align consistently */
  nameLtr: {
    alignSelf: 'stretch',
    textAlign: 'left',
    width: '100%',
    writingDirection: 'ltr',
  },
  username: { fontSize: 14, marginTop: 2 },
  actionBtn: {
    marginLeft: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', fontSize: 16, paddingHorizontal: 24 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', paddingTop: 48 },
});

export default FollowListScreen;
