import React, { useState, useEffect, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';

const SearchScreen = ({ navigation }: any) => {
  const { user: currentUser, updateUser } = useUser();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestedUsers, setSuggestedUsers] = useState<any[]>([]);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchLoading, setSearchLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingUserIds, setUpdatingUserIds] = useState<Record<string, boolean>>({});

  const followingSet = useMemo(() => {
    const ids = (currentUser?.following || []).map((id: any) => id?.toString()).filter(Boolean);
    return new Set(ids);
  }, [currentUser?.following]);

  useEffect(() => {
    fetchSuggestedUsers();
  }, []);

  // Refresh when screen comes into focus to pick up follow/unfollow changes from other screens
  useFocusEffect(
    React.useCallback(() => {
      // Only refresh if we're not searching (showing suggested users)
      if (!searchQuery.trim()) {
        // Small delay to ensure UserContext has updated
        const timer = setTimeout(() => {
          fetchSuggestedUsers();
        }, 100);
        return () => clearTimeout(timer);
      }
    }, [searchQuery])
  );

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

  const fetchSuggestedUsers = async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    
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
      setSuggestedUsers(filtered);
    } catch (error) {
      console.error('Error fetching suggested users:', error);
      setSuggestedUsers([]);
      showToast('Error', 'Failed to load suggested users', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    if (!searchQuery.trim()) {
      // Only refresh suggested users if not searching
      fetchSuggestedUsers(true);
    }
  };

  const handleSearch = async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
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
      setSearchResults(filtered);
    } catch (error) {
      console.error('Error searching users:', error);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
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

    setUpdatingUserIds((prev) => ({ ...prev, [targetId]: true }));
    try {
      const data = await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${targetId}`);

      if (data?.error) {
        showToast('Error', data.error, 'error');
        return;
      }

      const isCurrentlyFollowing = followingSet.has(targetId);
      const nextFollowing = isCurrentlyFollowing
        ? (currentUser.following || []).filter((id: any) => id?.toString() !== targetId)
        : [...(currentUser.following || []), targetId];

      updateUser({ following: nextFollowing as any });

      // Web removes user from suggestions immediately when newly followed
      if (!isCurrentlyFollowing) {
        setSuggestedUsers((prev) => prev.filter((u) => u?._id?.toString() !== targetId));
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
    const isFollowing = userId ? followingSet.has(userId) : false;

    return (
      <View style={[styles.userItem, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.userTapArea}
          onPress={() => navigation.navigate('Profile', { 
            screen: 'UserProfile', 
            params: { username: item.username } 
          })}
          activeOpacity={0.8}
        >
          {item.profilePic ? (
            <Image source={{ uri: item.profilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
              <Text style={styles.avatarText}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
            </View>
          )}
          <View style={styles.userInfo}>
            <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={[styles.userUsername, { color: colors.textGray }]} numberOfLines={1}>
              @{item.username}
            </Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.followButton,
            { backgroundColor: colors.primary },
            isFollowing && styles.followButtonFollowing,
            isFollowing && { backgroundColor: colors.border },
            isUpdating && styles.followButtonDisabled
          ]}
          onPress={() => handleFollowToggle(item)}
          disabled={isUpdating}
          activeOpacity={0.85}
        >
          {isUpdating ? (
            <ActivityIndicator size="small" color={colors.buttonText} />
          ) : (
            <Text style={[styles.followButtonText, { color: colors.buttonText }, isFollowing && styles.followButtonTextFollowing]}>
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
      </View>

      <TextInput
        style={[styles.searchInput, { backgroundColor: colors.backgroundLight, color: colors.text, borderColor: colors.border }]}
        placeholder="Search users..."
        placeholderTextColor={colors.textGray}
        value={searchQuery}
        onChangeText={setSearchQuery}
        autoCapitalize="none"
      />

      {searchLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {searchQuery.trim() ? (
        <FlatList
          data={searchResults}
          renderItem={renderUser}
          keyExtractor={(item) => item._id}
          ListEmptyComponent={
            !searchLoading && (
              <Text style={[styles.emptyText, { color: colors.textGray }]}>No users found</Text>
            )
          }
        />
      ) : (
        <View style={styles.suggestedSection}>
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Suggested Users</Text>
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <FlatList
              data={suggestedUsers}
              renderItem={renderUser}
              keyExtractor={(item) => item._id}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={handleRefresh}
                  tintColor={colors.primary}
                />
              }
            />
          )}
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
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  searchInput: {
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 15,
    margin: 15,
    color: COLORS.text,
    fontSize: 16,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
  },
  suggestedSection: {
    flex: 1,
    padding: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 15,
  },
  userItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  userTapArea: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    minWidth: 0,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 3,
  },
  userUsername: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  followButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minWidth: 92,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  followButtonFollowing: {
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  followButtonDisabled: {
    opacity: 0.7,
  },
  followButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 13,
  },
  followButtonTextFollowing: {
    color: COLORS.text,
  },
  emptyText: {
    textAlign: 'center',
    color: COLORS.textGray,
    marginTop: 50,
    fontSize: 16,
  },
});

export default SearchScreen;
