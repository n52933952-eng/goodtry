import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
  Keyboard,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { isFollowedInSessionList, toUserIdStr } from '../../utils/followState';
import { rememberFollowProfile, removeFollowProfile } from '../../utils/recentFollowProfiles';
import { usePost } from '../../context/PostContext';
import { injectFollowedUserPostsIntoFeed } from '../../utils/injectFollowedUserPostsIntoFeed';

/** Keep search text on the left (same as English) when typing Arabic on RTL devices. */
const SEARCH_INPUT_LTR = {
  textAlign: 'left' as const,
  writingDirection: 'ltr' as const,
};

const SearchScreen = ({ navigation }: any) => {
  const { user: currentUser, updateUser, refetchSessionUser } = useUser();
  const { injectPostsIntoFeed } = usePost();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingUserIds, setUpdatingUserIds] = useState<Record<string, boolean>>({});
  const searchInputRef = useRef<TextInput>(null);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setSearchLoading(false);
    Keyboard.dismiss();
    searchInputRef.current?.blur();
  }, []);

  const followingSet = useMemo(() => {
    const ids = (currentUser?.following || []).map((id: unknown) => toUserIdStr(id)).filter(Boolean);
    return new Set(ids);
  }, [currentUser?.following]);

  const sessionFollowingLoaded = !!currentUser?._id && Array.isArray(currentUser?.following);

  const followStateForUser = useCallback(
    (u: { _id?: unknown; isFollowedByMe?: boolean } | null | undefined) =>
      isFollowedInSessionList(u, followingSet, sessionFollowingLoaded),
    [followingSet, sessionFollowingLoaded],
  );

  const stampFollowFlags = (users: any[]) =>
    users.map((u) => ({
      ...u,
      isFollowedByMe: followStateForUser(u),
    }));

  useEffect(() => {
    void (async () => {
      await refetchSessionUser?.();
      fetchSuggestedUsers({ initial: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync buttons after follow on web or another screen
  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      void (async () => {
        await refetchSessionUser?.();
        if (cancelled) return;
        if (!searchQuery.trim()) {
          await fetchSuggestedUsers();
        } else {
          await handleSearch(searchQuery);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [searchQuery])
  );

  // Re-stamp list rows when /me following[] updates (no extra network)
  useEffect(() => {
    setSuggestedUsers((prev) => (prev.length ? stampFollowFlags(prev) : prev));
    setSearchResults((prev) => (prev.length ? stampFollowFlags(prev) : prev));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followingSet]);

  useEffect(() => {
    if (searchQuery.trim()) {
      handleSearch(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  // List of all system accounts/channels to filter out (only show real users)
  // Check both username and name fields
  const systemAccounts = [
    'Football', 'Weather', 'AlJazeera', 'NBCNews', 'BeinSportsNews', 
    'SkyNews', 'Sky News', 'Sky Sport', 'Cartoonito', 'NatGeoKids', 
    'SciShowKids', 'JJAnimalTime', 'KidsArabic', 'NatGeoAnimals', 
    'MBCDrama', 'Fox11', 'NBC News', 'beIN SPORTS', 'MBC Drama'
  ];
  
  const isSystemAccount = (user: any) => {
    if (!user) return false;
    const username = user.username?.toLowerCase().trim() || '';
    const name = user.name?.toLowerCase().trim() || '';
    
    return systemAccounts.some(sys => {
      const sysLower = sys.toLowerCase();
      return username === sysLower || name === sysLower || 
             name.includes(sysLower) || username.includes(sysLower);
    });
  };

  const fetchSuggestedUsers = async (opts?: { initial?: boolean }) => {
    if (opts?.initial) setLoading(true);

    try {
      const data = await apiService.get(ENDPOINTS.GET_SUGGESTED_USERS);
      const arr = Array.isArray(data) ? data : [];
      // Filter out ALL system accounts/channels - only show real users
      const filtered = arr.filter((u: any) => {
        if (!u || !u.username) return false;
        // Exclude system accounts (check both username and name)
        if (isSystemAccount(u)) {
          return false;
        }
        // Only include real users (must have a valid username)
        return u.username.trim().length > 0;
      });
      setSuggestedUsers(stampFollowFlags(filtered));
    } catch (error) {
      console.error('Error fetching suggested users:', error);
      setSuggestedUsers([]);
      showToast('Error', 'Failed to load suggested users', 'error');
    } finally {
      if (opts?.initial) setLoading(false);
    }
  };

  const handleRefresh = () => {
    // Must set synchronously — delaying until after refetch breaks every 2nd pull on Android.
    setRefreshing(true);
    void (async () => {
      try {
        await refetchSessionUser?.();
        if (!searchQuery.trim()) {
          await fetchSuggestedUsers();
        } else {
          await handleSearch(searchQuery, { silent: true });
        }
      } finally {
        setRefreshing(false);
      }
    })();
  };

  const handleSearch = async (query: string, opts?: { silent?: boolean }) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    if (!opts?.silent) setSearchLoading(true);
    try {
      const data = await apiService.get(`${ENDPOINTS.SEARCH_USERS}?search=${encodeURIComponent(query)}`);
      const arr = Array.isArray(data) ? data : [];
      // Filter out ALL system accounts/channels - only show real users
      const filtered = arr.filter((u: any) => {
        if (!u || !u.username) return false;
        // Exclude system accounts (check both username and name)
        if (isSystemAccount(u)) {
          return false;
        }
        // Only include real users (must have a valid username)
        return u.username.trim().length > 0;
      });
      setSearchResults(stampFollowFlags(filtered));
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      if (!opts?.silent) setSearchLoading(false);
    }
  };

  const handleFollowToggle = async (targetUser: any) => {
    if (!currentUser?._id) {
      showToast('Error', 'Must be logged in to follow', 'error');
      return;
    }

    const targetId = targetUser?._id?.toString();
    if (!targetId) return;

    if (targetId === currentUser._id?.toString()) {
      showToast('Error', 'Cannot follow yourself', 'error');
      return;
    }

    if (updatingUserIds[targetId]) return;

    const isCurrentlyFollowing = followStateForUser(targetUser);

    setUpdatingUserIds((prev) => ({ ...prev, [targetId]: true }));
    try {
      const data = await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${targetId}`);

      if (data?.error) {
        showToast('Error', data.error, 'error');
        return;
      }

      const newFollowState = !isCurrentlyFollowing;

      // Update isFollowedByMe on the item in both lists so re-renders are accurate
      const updateList = (arr: any[]) =>
        arr.map((u) =>
          u?._id?.toString() === targetId ? { ...u, isFollowedByMe: newFollowState } : u
        );
      setSearchResults((prev) => updateList(prev));
      setSuggestedUsers((prev) => updateList(prev));

      // Prefer server session snapshot when it includes a plausible following list.
      // Avoid treating [] as authoritative right after a follow (stale/empty payloads used to wipe context).
      const serverFollowing = data?.current?.following;
      const canTrustServerFollowing =
        Array.isArray(serverFollowing) &&
        (serverFollowing.length > 0 || (serverFollowing.length === 0 && !newFollowState));

      if (canTrustServerFollowing && Array.isArray(data?.current?.followers)) {
        updateUser({
          following: serverFollowing as any,
          followers: data.current.followers as any,
        });
      } else if (canTrustServerFollowing) {
        updateUser({
          following: serverFollowing as any,
          followers: currentUser.followers as any,
        });
      } else {
        const nextFollowing = isCurrentlyFollowing
          ? (currentUser.following || []).filter((id: any) => id?.toString() !== targetId)
          : [...(currentUser.following || []), targetId];
        updateUser({ following: nextFollowing as any });
      }

      // Remove from suggestions when newly followed
      if (newFollowState) {
        rememberFollowProfile(targetUser);
        setSuggestedUsers((prev) => prev.filter((u) => u?._id?.toString() !== targetId));
        void injectFollowedUserPostsIntoFeed(targetId, injectPostsIntoFeed);
      } else {
        removeFollowProfile(targetId);
      }

      showToast(
        'Success',
        isCurrentlyFollowing
          ? `Unfollowed ${targetUser?.name || targetUser?.username || 'user'}`
          : `Following ${targetUser?.name || targetUser?.username || 'user'}`,
        'success'
      );
    } catch (e: any) {
      showToast('Error', e?.message || 'Failed to update follow status', 'error');
    } finally {
      setUpdatingUserIds((prev) => ({ ...prev, [targetId]: false }));
    }
  };

  const renderUser = ({ item }: { item: any }) => {
    const userId = item?._id?.toString() || '';
    const isUpdating = !!(userId && updatingUserIds[userId]);
    const isFollowing = followStateForUser(item);

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
          onPress={() =>
            navigation.navigate('UserProfile', {
              username: item.username,
            })
          }
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
              {item.name || 'Unknown'}
            </Text>
            <Text style={[styles.username, styles.nameLtr, { color: colors.textGray }]} numberOfLines={1}>
              @{item.username}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.actionBtn,
            isFollowing
              ? { borderColor: colors.border }
              : { borderColor: colors.primary },
            isUpdating && styles.actionBtnDisabled,
          ]}
          onPress={() => handleFollowToggle(item)}
          disabled={isUpdating}
          activeOpacity={0.85}
        >
          {isUpdating ? (
            <ActivityIndicator size="small" color={isFollowing ? colors.text : colors.primary} />
          ) : (
            <Text
              style={[
                styles.actionBtnText,
                isFollowing ? { color: colors.text } : { color: colors.primary },
              ]}
            >
              {isFollowing ? 'Unfollow' : 'Follow'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Search</Text>
        <TouchableOpacity
          style={[styles.refreshBtn, refreshing && styles.refreshBtnDisabled]}
          onPress={handleRefresh}
          disabled={refreshing}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Refresh users"
        >
          {refreshing ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={[styles.refreshIcon, { color: colors.primary }]}>↻</Text>
          )}
        </TouchableOpacity>
      </View>

      <View
        style={[
          styles.searchInputRow,
          { backgroundColor: colors.backgroundLight, borderColor: colors.border },
        ]}
      >
        <TextInput
          ref={searchInputRef}
          style={[
            styles.searchInput,
            SEARCH_INPUT_LTR,
            { color: colors.text, paddingRight: searchQuery.length > 0 ? 48 : 12 },
          ]}
          placeholder="Search users..."
          placeholderTextColor={colors.textGray}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          returnKeyType="search"
          textAlign="left"
        />
        {searchQuery.length > 0 ? (
          <Pressable
            onPressIn={clearSearch}
            style={({ pressed }) => [
              styles.searchClearBtn,
              pressed && styles.searchClearBtnPressed,
            ]}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Clear search"
          >
            <View style={[styles.searchClearBtnInner, { backgroundColor: colors.border }]}>
              <Text style={[styles.searchClearBtnText, { color: colors.text }]}>✕</Text>
            </View>
          </Pressable>
        ) : null}
      </View>

      {searchQuery.trim() ? (
        <FlatList
          data={searchResults}
          renderItem={renderUser}
          keyExtractor={(item) => item._id}
          contentContainerStyle={
            searchResults.length === 0
              ? styles.listEmptyGrow
              : [styles.listContent, { paddingTop: 14, backgroundColor: colors.background }]
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
          ListEmptyComponent={
            searchLoading ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
            ) : (
              <Text style={[styles.emptyText, { color: colors.textGray }]}>No users found</Text>
            )
          }
        />
      ) : (
        <View style={[styles.suggestedSection, { backgroundColor: colors.background }]}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Suggested Users</Text>
          <FlatList
            data={suggestedUsers}
            renderItem={renderUser}
            keyExtractor={(item) => item._id}
            contentContainerStyle={
              suggestedUsers.length === 0
                ? styles.listEmptyGrow
                : [styles.listContent, { paddingTop: 8, paddingBottom: 20, backgroundColor: colors.background }]
            }
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                tintColor={colors.primary}
                colors={[colors.primary]}
              />
            }
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
              ) : (
                <Text style={[styles.emptyText, { color: colors.textGray }]}>No suggested users</Text>
              )
            }
          />
        </View>
      )}
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
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
    flex: 1,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refreshBtnDisabled: {
    opacity: 0.6,
  },
  refreshIcon: {
    fontSize: 26,
    fontWeight: '700',
  },
  searchInputRow: {
    position: 'relative',
    borderWidth: 1,
    borderRadius: 8,
    marginHorizontal: 16,
    marginVertical: 12,
    minHeight: 52,
    justifyContent: 'center',
    direction: 'ltr',
  },
  searchInput: {
    width: '100%',
    paddingVertical: 14,
    paddingLeft: 15,
    fontSize: 16,
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  searchClearBtn: {
    position: 'absolute',
    right: 6,
    top: 0,
    bottom: 0,
    width: 48,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    elevation: 10,
  },
  searchClearBtnPressed: {
    opacity: 0.65,
  },
  searchClearBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchClearBtnText: {
    fontSize: 16,
    fontWeight: '700',
    lineHeight: 18,
  },
  suggestedSection: {
    flex: 1,
    paddingTop: 4,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  /** Match FollowListScreen row/card layout */
  rowLtr: { direction: 'ltr' },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  listEmptyGrow: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingTop: 48,
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
  actionBtnDisabled: { opacity: 0.7 },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
  emptyText: {
    textAlign: 'center',
    color: COLORS.textGray,
    marginTop: 50,
    fontSize: 16,
    paddingHorizontal: 24,
  },
});

export default SearchScreen;
