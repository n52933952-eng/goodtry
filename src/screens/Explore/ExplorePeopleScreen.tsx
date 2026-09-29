import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { usePost } from '../../context/PostContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { injectFollowedUserPostsIntoFeed } from '../../utils/injectFollowedUserPostsIntoFeed';
import { rememberFollowProfile } from '../../utils/recentFollowProfiles';
import { isVideoUrl, mediaDisplayUrl, videoPosterUrl } from '../../utils/mediaUrl';
import VideoFeedPreview from '../../components/VideoFeedPreview';
import { useWideScreenLayout } from '../../utils/responsiveLayout';

const PAGE_SIZE = 16;
const GRID_PAD = 10;
const GRID_GAP = 8;

function exploreNameKey(user: any) {
  const name = String(user?.name || '').trim().toLowerCase();
  if (name) return name;
  return String(user?.username || '').trim().toLowerCase();
}

function uniqueExplorePeople(list: any[]) {
  const seenUser = new Set<string>();
  const seenName = new Set<string>();
  const seenPost = new Set<string>();
  const out: any[] = [];
  for (const u of list) {
    const id = String(u?._id || '');
    const postId = String(u?.latestPost?._id || '');
    const name = exploreNameKey(u);
    if (!id || seenUser.has(id)) continue;
    if (name && seenName.has(name)) continue;
    if (postId && seenPost.has(postId)) continue;
    seenUser.add(id);
    if (name) seenName.add(name);
    if (postId) seenPost.add(postId);
    out.push(u);
  }
  return out;
}

function clipWords(text: string, max = 10) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'No posts yet';
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ')} …`;
}

const ExplorePeopleScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const wide = useWideScreenLayout(720);
  const numColumns = wide.isWide ? 3 : 2;
  const gridWidth = wide.isWide ? 720 : windowWidth;
  const tileSize = Math.max(
    120,
    Math.floor((gridWidth - GRID_PAD * 2 - GRID_GAP * (numColumns - 1)) / numColumns),
  );
  const compact = tileSize < 158;
  const { colors, theme } = useTheme();
  const { user: currentUser, updateUser } = useUser();
  const { injectPostsIntoFeed } = usePost();
  const showToast = useShowToast();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [followingId, setFollowingId] = useState<string | null>(null);
  const usersRef = useRef<any[]>([]);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);
  const countryRef = useRef(String(currentUser?.country || ''));
  usersRef.current = users;

  const load = useCallback(async (mode: 'reset' | 'more' = 'reset') => {
    if (mode === 'more') {
      if (loadingMoreRef.current || !hasMoreRef.current) return;
      loadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      hasMoreRef.current = true;
      setHasMore(true);
    }
    try {
      const exclude =
        mode === 'more'
          ? usersRef.current.map((u) => String(u._id || '')).filter(Boolean).slice(0, 80).join(',')
          : '';
      const q = exclude
        ? `?limit=${PAGE_SIZE}&exclude=${encodeURIComponent(exclude)}`
        : `?limit=${PAGE_SIZE}`;
      const data = await apiService.get(`${ENDPOINTS.EXPLORE_PEOPLE}${q}`);
      const next = Array.isArray(data?.users) ? data.users : [];
      const more = data?.hasMore === true && next.length > 0;
      hasMoreRef.current = more;
      setHasMore(more);
      if (mode === 'more') {
        setUsers((prev) => {
          const merged = uniqueExplorePeople([...prev, ...next]);
          if (merged.length === prev.length) {
            hasMoreRef.current = false;
            setHasMore(false);
          }
          return merged;
        });
      } else {
        setUsers(uniqueExplorePeople(next));
      }
    } catch (e: any) {
      showToast('Error', e?.message || 'Could not load people', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      loadingMoreRef.current = false;
    }
  }, [showToast]);

  useFocusEffect(
    useCallback(() => {
      const nextCountry = String(currentUser?.country || '');
      const countryChanged = countryRef.current !== nextCountry;
      countryRef.current = nextCountry;
      if (usersRef.current.length === 0 || countryChanged) load('reset');
    }, [load, currentUser?.country]),
  );

  const follow = async (target: any) => {
    const targetId = String(target?._id || '');
    if (!targetId || !currentUser?._id || followingId) return;
    setFollowingId(targetId);
    try {
      const data = await apiService.post(`${ENDPOINTS.FOLLOW_USER}/${targetId}`);
      if (data?.error) {
        showToast('Error', data.error, 'error');
        return;
      }
      const serverFollowing = data?.current?.following;
      if (Array.isArray(serverFollowing)) {
        updateUser({ following: serverFollowing as any, followers: data.current?.followers || currentUser.followers });
      } else {
        updateUser({ following: [...(currentUser.following || []), targetId] as any });
      }
      rememberFollowProfile(target);
      void injectFollowedUserPostsIntoFeed(targetId, injectPostsIntoFeed);
      setUsers((prev) => prev.filter((u) => String(u._id) !== targetId));
      showToast('Success', `Following ${target?.name || target?.username || 'user'}`, 'success');
    } catch (e: any) {
      showToast('Error', e?.message || 'Follow failed', 'error');
    } finally {
      setFollowingId(null);
    }
  };

  const openProfile = (item: any) => {
    const username = String(item?.username || '').trim();
    if (!username) return;
    navigation.navigate('UserProfile', { username });
  };

  const renderItem = ({ item }: { item: any }) => {
    const preview = item.latestPost;
    const raw = String(preview?.img || '').trim();
    const img = mediaDisplayUrl(raw);
    const text = String(preview?.text || '').trim();
    const video = isVideoUrl(img);
    const poster = video ? videoPosterUrl(img) : '';
    const dark = theme === 'dark';
    const tile = { width: tileSize, height: tileSize };
    const snippet = clipWords(text, 20);
    const wordCount = snippet.replace(' …', '').trim().split(/\s+/).filter(Boolean).length;
    const shortQuote = wordCount <= 3;
    const isText = !img && !video;

    const personRow = (onPhoto: boolean) => (
      <View style={[styles.personBar, onPhoto ? styles.personBarPhoto : styles.personBarText]} pointerEvents="box-none">
        <TouchableOpacity style={styles.personLeft} onPress={() => openProfile(item)}>
            {item.profilePic ? (
              <Image source={{ uri: item.profilePic }} style={[styles.avatar, compact && styles.avatarCompact]} />
            ) : (
            <View style={[styles.avatar, compact && styles.avatarCompact, styles.avatarFallback, { backgroundColor: onPhoto ? 'rgba(0,0,0,0.35)' : colors.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: compact ? 9 : 10 }}>
                {(item.name || item.username || '?')[0]?.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.nameOnCard, compact && styles.nameCompact, !onPhoto && { color: colors.text, textShadowRadius: 0 }]} numberOfLines={1}>
            {item.username ? `@${item.username}` : (item.name || 'User')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.followBtnInline, compact && styles.followBtnCompact]}
          onPress={() => follow(item)}
          disabled={followingId === String(item._id)}
        >
          <Text style={[styles.followText, compact && styles.followTextCompact]}>
            {followingId === String(item._id) ? '…' : 'Follow'}
          </Text>
        </TouchableOpacity>
      </View>
    );

    return (
      <View style={[styles.card, { width: tileSize, backgroundColor: colors.background }]}>
        <TouchableOpacity activeOpacity={0.9} onPress={() => openProfile(item)}>
          {video && img ? (
            <View style={[styles.mediaFrame, tile, { backgroundColor: dark ? '#0B0F14' : '#111827' }]}>
              <VideoFeedPreview
                videoUrl={img}
                serverThumbnail={poster || null}
                placeholderColor={dark ? '#0B0F14' : '#111827'}
                spinnerColor="#fff"
                resizeMode="cover"
              />
              <View style={styles.playOverlay} pointerEvents="none">
                <View style={styles.playBadge}>
                  <Text style={styles.playIcon}>▶</Text>
                </View>
              </View>
            </View>
          ) : img ? (
            <Image source={{ uri: img }} style={[styles.preview, tile]} resizeMode="cover" />
          ) : (
            <View
              style={[
                styles.textCard,
                tile,
                {
                  backgroundColor: dark ? '#101820' : '#F4F8FF',
                  borderColor: dark ? 'rgba(29,161,242,0.22)' : 'rgba(29,155,240,0.18)',
                },
              ]}
            >
              <View style={[styles.textAccent, { backgroundColor: colors.primary }]} />
              <Text style={[styles.quoteMark, { color: colors.primary }]}>“</Text>
              <Text
                style={[
                  styles.textBody,
                  {
                    color: colors.text,
                    fontSize: shortQuote ? (compact ? 16 : 18) : (compact ? 12 : 13),
                    lineHeight: shortQuote ? (compact ? 21 : 24) : (compact ? 16 : 18),
                    textAlign: shortQuote ? 'center' : 'left',
                  },
                ]}
                numberOfLines={shortQuote ? 3 : 5}
              >
                {snippet}
              </Text>
            </View>
          )}
        </TouchableOpacity>
        {personRow(!isText)}
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) {
              navigation.goBack();
              return;
            }
            navigation.navigate('Feed', { screen: 'FeedScreen' });
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.back, { color: colors.text }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>Explore</Text>
        <TouchableOpacity onPress={() => { setRefreshing(true); load('reset'); }}>
          <Text style={[styles.refresh, { color: colors.primary }]}>↻</Text>
        </TouchableOpacity>
      </View>
      {loading && users.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          key={`explore-${numColumns}`}
          data={users}
          keyExtractor={(item) => String(item._id)}
          renderItem={renderItem}
          numColumns={numColumns}
          columnWrapperStyle={{ gap: GRID_GAP, paddingHorizontal: GRID_PAD, marginBottom: GRID_GAP }}
          contentContainerStyle={[
            { paddingTop: 4, paddingBottom: 24 + insets.bottom },
            wide.contentCap,
          ]}
          onEndReached={() => load('more')}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} /> : null
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load('reset'); }} />
          }
          ListEmptyComponent={
            <Text style={{ color: colors.textGray, textAlign: 'center', marginTop: 40 }}>
              No people to show yet. Pull to refresh.
            </Text>
          }
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { fontSize: 16, fontWeight: '600', width: 70 },
  title: { fontSize: 18, fontWeight: '700' },
  refresh: { fontSize: 22, width: 70, textAlign: 'right' },
  card: {
    borderRadius: 10,
    overflow: 'hidden',
    position: 'relative',
  },
  personBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  personBarPhoto: {
    backgroundColor: 'rgba(0,0,0,0.38)',
  },
  personBarText: {
    backgroundColor: 'transparent',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.28)',
  },
  personLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginRight: 6,
  },
  avatar: { width: 20, height: 20, borderRadius: 10 },
  avatarCompact: { width: 18, height: 18, borderRadius: 9 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  nameOnCard: {
    flex: 1,
    minWidth: 0,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  nameCompact: { fontSize: 10 },
  preview: { borderRadius: 10, backgroundColor: 'transparent' },
  mediaFrame: {
    overflow: 'hidden',
    position: 'relative',
    borderRadius: 10,
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  playIcon: {
    color: '#fff',
    fontSize: 14,
    marginLeft: 2,
    fontWeight: '700',
  },
  textCard: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 44,
    justifyContent: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  textAccent: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 48,
    width: 3,
    borderRadius: 3,
  },
  quoteMark: {
    fontSize: 28,
    lineHeight: 28,
    fontWeight: '800',
    opacity: 0.55,
    marginBottom: 2,
  },
  textBody: {
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  followBtnInline: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#1DA1F2', flexShrink: 0 },
  followBtnCompact: { paddingHorizontal: 6, paddingVertical: 3 },
  followText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  followTextCompact: { fontSize: 10 },
});

export default ExplorePeopleScreen;
