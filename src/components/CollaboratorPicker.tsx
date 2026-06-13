import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  FlatList,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import UserListSearchBar from './UserListSearchBar';
import { filterUsersByQuery } from '../utils/filterUsersByQuery';
import {
  SYSTEM_COLLABORATOR_USERNAMES,
  CollaboratorUser,
} from '../utils/collaborators';

const PAGE_SIZE = 9;

type Props = {
  /** User ids hidden from the list (creator, owner, existing contributors). */
  excludeUserIds: string[];
  selectedIds: string[];
  onToggleUser: (u: CollaboratorUser, selected: boolean) => void;
};

function normalizeFollowListResponse(data: any): {
  users: CollaboratorUser[];
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

/**
 * Paginated following list + search for choosing collaborators.
 * Search bar stays fixed above the list; rows show Add / Remove toggle.
 */
const CollaboratorPicker: React.FC<Props> = ({
  excludeUserIds,
  selectedIds,
  onToggleUser,
}) => {
  const { t } = useLanguage();
  const { colors } = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [followingUsers, setFollowingUsers] = useState<CollaboratorUser[]>([]);
  const [searchResults, setSearchResults] = useState<CollaboratorUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const nextSkipRef = useRef(0);

  const exclude = useMemo(
    () => new Set(excludeUserIds.filter(Boolean).map((id) => String(id))),
    [excludeUserIds.join('|')]
  );
  const selectedSet = useMemo(
    () => new Set(selectedIds.filter(Boolean).map((id) => String(id))),
    [selectedIds.join('|')]
  );

  const fetchFollowingPage = useCallback(async (skip: number, mode: 'replace' | 'append') => {
    const data = await apiService.get(
      `${ENDPOINTS.GET_FOLLOWING_USERS}?limit=${PAGE_SIZE}&skip=${skip}`
    );
    const { users: page, hasMore: more, nextSkip } = normalizeFollowListResponse(data);
    const filtered = page.filter((u) => {
      const id = u._id?.toString();
      return id && !exclude.has(id) && !SYSTEM_COLLABORATOR_USERNAMES.has(u.username || '');
    });

    if (mode === 'replace') {
      setFollowingUsers(filtered);
    } else {
      setFollowingUsers((prev) => {
        const seen = new Set(prev.map((u) => String(u._id)));
        const merged = [...prev];
        for (const u of filtered) {
          const id = String(u._id);
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
  }, [exclude]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      nextSkipRef.current = 0;
      try {
        await fetchFollowingPage(0, 'replace');
      } catch {
        if (!cancelled) setFollowingUsers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchFollowingPage]);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await apiService.get(
          `${ENDPOINTS.SEARCH_USERS}?search=${encodeURIComponent(q)}`
        );
        const list = Array.isArray(data) ? data : [];
        const filtered = list.filter((u: CollaboratorUser) => {
          const id = u._id?.toString();
          return (
            id &&
            !exclude.has(id) &&
            !SYSTEM_COLLABORATOR_USERNAMES.has(u.username || '')
          );
        });
        setSearchResults(filtered);
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, exclude]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || searchQuery.trim().length >= 2) return;
    setLoadingMore(true);
    try {
      await fetchFollowingPage(nextSkipRef.current, 'append');
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, searchQuery, fetchFollowingPage]);

  const listData = useMemo(() => {
    const q = searchQuery.trim();
    if (q.length >= 2) return searchResults;
    if (q.length === 1) return filterUsersByQuery(followingUsers, q);
    return followingUsers;
  }, [searchQuery, searchResults, followingUsers]);

  const renderRow = ({ item: u }: { item: CollaboratorUser }) => {
    const id = u._id?.toString();
    if (!id) return null;
    const isSelected = selectedSet.has(id);

    return (
      <View
        style={[styles.row, { backgroundColor: colors.background, borderColor: colors.border }]}
      >
        {u.profilePic ? (
          <Image source={{ uri: u.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPh, { backgroundColor: colors.avatarBg }]}>
            <Text style={styles.avatarTxt}>
              {(u.name || u.username || '?')[0]?.toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.userInfo}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {u.name}
          </Text>
          <Text style={[styles.sub, { color: colors.textGray }]} numberOfLines={1}>
            @{u.username}
          </Text>
        </View>
        <TouchableOpacity
          style={[
            styles.actionBtn,
            {
              backgroundColor: isSelected ? colors.background : colors.primary,
              borderColor: isSelected ? colors.error : colors.primary,
            },
          ]}
          onPress={() => onToggleUser(u, !isSelected)}
        >
          <Text
            style={[
              styles.actionBtnText,
              { color: isSelected ? colors.error : '#fff' },
            ]}
          >
            {isSelected ? t('remove') : t('add')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

  const emptyMessage = (() => {
    const q = searchQuery.trim();
    if (q.length >= 2 && !isSearching) return t('noUsersFound');
    if (q.length === 1) return t('typeMoreToSearchGlobally');
    if (!loading && followingUsers.length === 0) return t('notFollowingAnyoneSearchContributors');
    return '';
  })();

  const listFooter =
    loadingMore && !searchQuery.trim() ? (
      <View style={styles.footerLoading}>
        <ActivityIndicator size="small" color={colors.primary} />
      </View>
    ) : null;

  return (
    <View style={styles.container}>
      <View style={[styles.searchWrap, { backgroundColor: colors.backgroundLight }]}>
        <UserListSearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('searchContributorsPlaceholder')}
        />
      </View>

      {isSearching ? (
        <ActivityIndicator style={styles.searchSpinner} color={colors.primary} />
      ) : null}

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          style={styles.list}
          data={listData}
          keyExtractor={(item) => item._id?.toString() || String(item.username)}
          renderItem={renderRow}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          onEndReached={searchQuery.trim().length >= 2 ? undefined : loadMore}
          onEndReachedThreshold={0.35}
          ListFooterComponent={listFooter}
          ListEmptyComponent={
            emptyMessage ? (
              <Text style={[styles.empty, { color: colors.textGray }]}>{emptyMessage}</Text>
            ) : null
          }
          contentContainerStyle={
            listData.length === 0 ? styles.emptyContainer : styles.listContent
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchWrap: {
    paddingBottom: 10,
  },
  searchSpinner: {
    marginBottom: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  emptyContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLoading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  empty: {
    textAlign: 'center',
    fontSize: 14,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    direction: 'ltr',
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  avatarPh: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarTxt: {
    color: '#fff',
    fontWeight: '700',
  },
  userInfo: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    width: '100%',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  sub: {
    fontSize: 13,
    width: '100%',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  actionBtn: {
    marginLeft: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    minWidth: 72,
    alignItems: 'center',
  },
  actionBtnText: {
    fontWeight: '700',
    fontSize: 13,
  },
});

export default CollaboratorPicker;
