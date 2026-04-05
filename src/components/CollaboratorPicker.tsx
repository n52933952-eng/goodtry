import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import {
  SYSTEM_COLLABORATOR_USERNAMES,
  CollaboratorUser,
} from '../utils/collaborators';

type Props = {
  /** User ids to hide from pick lists (creator, owner, existing contributors, already selected). */
  excludeUserIds: string[];
  onSelectUser: (u: CollaboratorUser) => void;
};

/**
 * Search + following lists for choosing collaborators (create post or add-contributor flow).
 */
const CollaboratorPicker: React.FC<Props> = ({ excludeUserIds, onSelectUser }) => {
  const { t } = useLanguage();
  const { colors } = useTheme();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CollaboratorUser[]>([]);
  const [followingUsers, setFollowingUsers] = useState<CollaboratorUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingFollowing, setIsLoadingFollowing] = useState(false);

  const exclude = new Set(excludeUserIds.filter(Boolean).map((id) => String(id)));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoadingFollowing(true);
      try {
        const data = await apiService.get(ENDPOINTS.GET_FOLLOWING);
        const list = Array.isArray(data) ? data : [];
        if (!cancelled) setFollowingUsers(list);
      } catch {
        if (!cancelled) setFollowingUsers([]);
      } finally {
        if (!cancelled) setIsLoadingFollowing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      const filtered = followingUsers.filter((u) => {
        const id = u._id?.toString();
        if (!id || exclude.has(id)) return false;
        const nameMatch = u.name?.toLowerCase().includes(q.toLowerCase());
        const usernameMatch = u.username?.toLowerCase().includes(q.toLowerCase());
        return nameMatch || usernameMatch;
      });
      setSearchResults(filtered);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await apiService.get(
          `${ENDPOINTS.SEARCH_USERS}?search=${encodeURIComponent(q)}`
        );
        const list = Array.isArray(data) ? data : [];
        const filtered = list.filter((u: any) => {
          const id = u._id?.toString();
          return (
            id &&
            !exclude.has(id) &&
            !SYSTEM_COLLABORATOR_USERNAMES.has(u.username)
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
  }, [searchQuery, followingUsers, excludeUserIds.join('|')]);

  const showFollowingBlock = !searchQuery.trim() && followingUsers.length > 0;
  const showSearchBlock = searchQuery.trim().length >= 1 && searchResults.length > 0;

  const Row = ({ u }: { u: CollaboratorUser }) => (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: colors.background, borderColor: colors.border }]}
      onPress={() => onSelectUser(u)}
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
      <Text style={[styles.addLabel, { color: colors.primary }]}>{t('add')}</Text>
    </TouchableOpacity>
  );

  return (
    <View>
      <TextInput
        style={[
          styles.searchInput,
          { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
        ]}
        placeholder={t('searchContributorsPlaceholder')}
        placeholderTextColor={colors.textGray}
        value={searchQuery}
        onChangeText={setSearchQuery}
      />
      {isSearching && <ActivityIndicator style={{ marginVertical: 8 }} color={colors.primary} />}

      {showFollowingBlock && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textGray }]}>{t('peopleYouFollow')}</Text>
          {isLoadingFollowing ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            followingUsers.map((fu) => {
              const id = fu._id?.toString();
              if (!id || exclude.has(id) || SYSTEM_COLLABORATOR_USERNAMES.has(fu.username || '')) {
                return null;
              }
              return <Row key={fu._id} u={fu} />;
            })
          )}
        </View>
      )}

      {showSearchBlock && (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.textGray }]}>{t('searchResults')}</Text>
          {searchResults.map((r) => {
            const id = r._id?.toString();
            if (!id || exclude.has(id) || SYSTEM_COLLABORATOR_USERNAMES.has(r.username || '')) {
              return null;
            }
            return <Row key={r._id} u={r} />;
          })}
        </View>
      )}

      {searchQuery.trim().length >= 1 && searchResults.length === 0 && !isSearching && (
        <Text style={{ color: colors.textGray, textAlign: 'center', marginTop: 8 }}>
          {searchQuery.trim().length === 1
            ? t('typeMoreToSearchGlobally')
            : t('noUsersFound')}
        </Text>
      )}

      {!searchQuery && !isLoadingFollowing && followingUsers.length === 0 && (
        <Text style={{ color: colors.textGray, textAlign: 'center', marginTop: 8 }}>
          {t('notFollowingAnyoneSearchContributors')}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  searchInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 12,
  },
  section: {
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 8,
    /** Avatar + names + Add stay LTR so Arabic display names align like English in RTL locale. */
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
  addLabel: {
    marginLeft: 10,
    fontWeight: '600',
  },
});

export default CollaboratorPicker;
