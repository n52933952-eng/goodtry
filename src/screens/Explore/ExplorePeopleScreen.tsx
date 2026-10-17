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
import { getYouTubeVideoId } from '../../utils/channelPostUtils';
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

function exploreStillUrl(raw: string): string {
  const text = String(raw || '').trim();
  const youtubeId = getYouTubeVideoId(text);
  if (youtubeId) return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
  return mediaDisplayUrl(text);
}

function clipWords(text: string, max = 10) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'No posts yet';
  if (words.length <= max) return words.join(' ');
  return `${words.slice(0, max).join(' ')} …`;
}

const TEXT_FLAVORS = [
  { light: '#E7F4FF', dark: '#10283A', accent: '#1DA1F2' },
  { light: '#F3EEFF', dark: '#221838', accent: '#8B6CFF' },
  { light: '#E8FBF2', dark: '#10281E', accent: '#1DBF73' },
  { light: '#FFF3E6', dark: '#2C1C10', accent: '#F0A04B' },
  { light: '#FDECEF', dark: '#2C141C', accent: '#E86B86' },
  { light: '#E7F8F8', dark: '#102628', accent: '#2BB8C7' },
];

function textFlavor(seed: string) {
  let n = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) n = (n + s.charCodeAt(i) * (i + 1)) % TEXT_FLAVORS.length;
  return TEXT_FLAVORS[n];
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

  const openPost = (item: any) => {
    const postId = item?.latestPost?._id;
    if (!postId) {
      openProfile(item);
      return;
    }
    navigation.navigate('PostDetail', { postId: String(postId), fromScreen: 'Explore' });
  };

  const renderItem = ({ item }: { item: any }) => {
    const preview = item.latestPost;
    const raw = String(preview?.img || '').trim();
    const img = exploreStillUrl(raw);
    const text = String(preview?.text || '').trim();
    const video = isVideoUrl(img);
    const poster = video ? videoPosterUrl(img) : '';
    const dark = theme === 'dark';
    const circleSize = Math.round(tileSize * 0.88);
    const circleBox = {
      width: circleSize,
      height: circleSize,
      borderRadius: circleSize / 2,
      alignSelf: 'center' as const,
    };
    const ring = dark ? 'rgba(255,255,255,0.22)' : colors.border;
    const displayName = String(item.name || item.username || 'User').trim();
    const avatarUrl = String(item.profilePic || '').trim();
    const channelUrl = String(preview?.channelPic || '').trim();
    const imgIsAvatar = !!raw && (raw === avatarUrl || raw === channelUrl || img === avatarUrl || img === channelUrl);
    const photo = img && !imgIsAvatar ? img : '';
    const snippet = clipWords(text, 20);
    const wordCount = snippet.replace(' …', '').trim().split(/\s+/).filter(Boolean).length;
    const shortQuote = wordCount <= 3;
    const sameAsName = !!text && (text === item.username || text === item.name || text === displayName);
    const nameOnly = !photo && !video && (!text || sameAsName);

    const flavor = textFlavor(String(item._id || displayName));
    const letter = displayName[0]?.toUpperCase() || '?';
    const personRow = (
      <View style={styles.personBar} pointerEvents="box-none">
        <TouchableOpacity style={styles.personLeft} onPress={() => openProfile(item)}>
            {item.profilePic ? (
              <Image source={{ uri: item.profilePic }} style={[styles.avatar, compact && styles.avatarCompact]} />
            ) : (
            <View style={[styles.avatar, compact && styles.avatarCompact, styles.avatarFallback, { backgroundColor: colors.primary }]}>
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: compact ? 9 : 10 }}>
                {letter}
              </Text>
            </View>
          )}
          <Text style={[styles.nameOnCard, compact && styles.nameCompact, { color: colors.text }]} numberOfLines={1}>
            {displayName}
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
      <View style={[styles.card, { width: tileSize }]}>
        <View
          style={[
            styles.circleShadow,
            circleBox,
            { shadowOpacity: dark ? 0.4 : 0.12, backgroundColor: dark ? '#101820' : '#FFFFFF' },
          ]}
        >
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => openPost(item)}
          style={[
            styles.circleClip,
            { borderColor: ring, borderRadius: circleSize / 2, backgroundColor: dark ? '#101820' : '#F4F8FF' },
          ]}
        >
          {nameOnly ? (
            avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={[styles.preview, styles.stillFill, { backgroundColor: dark ? '#101820' : '#F4F8FF' }]} resizeMode="contain" />
            ) : (
            <View
              style={[
                styles.nameCard,
                styles.stillFill,
                { backgroundColor: dark ? '#101820' : '#F4F8FF' },
              ]}
            >
              <Text style={[styles.nameLetterText, { color: colors.primary }]}>{letter}</Text>
            </View>
            )
          ) : video && photo ? (
            <View style={[styles.mediaFrame, styles.stillFill, { backgroundColor: dark ? '#0B0F14' : '#111827' }]}>
              <VideoFeedPreview
                videoUrl={photo}
                serverThumbnail={poster || null}
                placeholderColor={dark ? '#0B0F14' : '#111827'}
                spinnerColor="#fff"
                resizeMode="contain"
              />
              <View style={styles.playOverlay} pointerEvents="none">
                <View style={styles.playBadge}>
                  <Text style={styles.playIcon}>▶</Text>
                </View>
              </View>
            </View>
          ) : photo ? (
            <View style={[styles.mediaFrame, styles.stillFill, { backgroundColor: dark ? '#101820' : '#F4F8FF' }]}>
              <Image key={photo} source={{ uri: photo }} style={styles.stillFill} resizeMode="contain" />
            </View>
          ) : (
            <View
              style={[
                styles.textCard,
                styles.stillFill,
                { backgroundColor: dark ? flavor.dark : flavor.light },
              ]}
            >
              <View style={[styles.textBlob, styles.textBlobTop, { backgroundColor: flavor.accent }]} />
              <View style={[styles.textBlob, styles.textBlobBottom, { backgroundColor: flavor.accent }]} />
              <Text style={[styles.quoteMark, { color: flavor.accent }]}>“</Text>
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
        </View>
        {personRow}
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
    position: 'relative',
  },
  circleShadow: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 5 },
    shadowRadius: 8,
    elevation: 3,
  },
  circleClip: {
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    borderWidth: 1,
  },
  personBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
    paddingTop: 8,
    paddingBottom: 2,
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
    fontSize: 13,
    fontWeight: '700',
  },
  nameCompact: { fontSize: 12 },
  preview: { backgroundColor: 'transparent' },
  stillFill: { width: '100%', height: '100%' },
  mediaFrame: {
    overflow: 'hidden',
    position: 'relative',
  },
  nameCard: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  nameLetterText: { fontSize: 42, fontWeight: '800' },
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
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  textBlob: {
    position: 'absolute',
    borderRadius: 999,
    opacity: 0.2,
  },
  textBlobTop: { width: 78, height: 78, top: -26, right: -18 },
  textBlobBottom: { width: 58, height: 58, bottom: -22, left: -16 },
  quoteMark: {
    fontSize: 36,
    lineHeight: 36,
    fontWeight: '800',
    opacity: 0.7,
    marginBottom: 0,
  },
  textBody: {
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  followBtnInline: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#1DA1F2', flexShrink: 0 },
  followBtnCompact: { paddingHorizontal: 6, paddingVertical: 3 },
  followText: { color: '#fff', fontWeight: '700', fontSize: 11 },
  followTextCompact: { fontSize: 10 },
});

export default ExplorePeopleScreen;
