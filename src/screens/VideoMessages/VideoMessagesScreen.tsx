import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  Image,
  Alert,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { createThumbnail } from 'react-native-create-thumbnail';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { useSocket } from '../../context/SocketContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { uploadMediaToR2 } from '../../utils/directR2Upload';
import { mediaDisplayUrl } from '../../utils/mediaUrl';
import { getVideoDurationSeconds } from '../../utils/videoDuration';
import { removeTempVideo, shrinkVideoForMessage } from '../../utils/lightVideo';
import { useShowToast } from '../../hooks/useShowToast';
import { useWideScreenLayout } from '../../utils/responsiveLayout';
import VideoFeedPreview from '../../components/VideoFeedPreview';

const PAGE = 15;

export function uidOf(v: any) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return String(v._id || v);
}

export function otherParty(item: any, meId: any) {
  return uidOf(item?.sender) === String(meId) ? item?.receiver : item?.sender;
}

export function fmtTime(sec: number) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n < 0) return '0:00';
  const s = Math.floor(n);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function unseenAmount(item: any, meId: any) {
  const me = String(meId);
  let n = 0;
  if (uidOf(item.receiver) === me && !item.seenAt) n += 1;
  if (uidOf(item.receiver) === me && (item.receiverUnseenNotes || 0) > 0) n += item.receiverUnseenNotes;
  if (uidOf(item.sender) === me) {
    const notes = item.senderUnseenNotes || 0;
    n += notes > 0 ? notes : item.senderHasNewNotes ? 1 : 0;
  }
  return n;
}

const VideoMessagesScreen = ({ navigation }: any) => {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = useWideScreenLayout();
  const { colors } = useTheme();
  const compact = width < 360;
  const thumbW = compact ? 64 : width > 700 ? 92 : 78;
  const thumbH = Math.round(thumbW * 1.28);
  const headerPad = Math.max(insets.top, 8) + (compact ? 10 : 16);
  const { user } = useUser();
  const { socket, setVideoMessageUnseenCount, refreshVideoMessageUnseenCount } = useSocket();
  const showToast = useShowToast();

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const fetchingRef = useRef(false);

  const [sendOpen, setSendOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [people, setPeople] = useState<any[]>([]);
  const [peopleMore, setPeopleMore] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const peopleSkipRef = useRef(0);
  const peopleBusyRef = useRef(false);
  const peopleReqRef = useRef(0);
  const [pickedUser, setPickedUser] = useState<any | null>(null);
  const [pickedAsset, setPickedAsset] = useState<any | null>(null);
  const [thumbUri, setThumbUri] = useState('');
  const [sending, setSending] = useState(false);
  const [sendHint, setSendHint] = useState('');

  const load = useCallback(async (more = false) => {
    if (fetchingRef.current) return;
    if (more && !cursorRef.current) return;
    fetchingRef.current = true;
    if (more) setLoadingMore(true);
    try {
      let url = `${ENDPOINTS.VIDEO_MESSAGES}?limit=${PAGE}`;
      if (more && cursorRef.current) url += `&cursor=${encodeURIComponent(cursorRef.current)}`;
      const data = await apiService.get(url);
      const page = Array.isArray(data?.items) ? data.items : [];
      cursorRef.current = data?.nextCursor || null;
      setHasMore(!!data?.hasMore);
      setItems((prev) => {
        if (!more) return page;
        const seen = new Set(prev.map((x) => String(x._id)));
        const out = [...prev];
        for (const row of page) {
          if (row?._id && !seen.has(String(row._id))) {
            seen.add(String(row._id));
            out.push(row);
          }
        }
        return out;
      });
    } catch (e: any) {
      showToast('Error', e?.message || 'Failed to load', 'error');
    } finally {
      fetchingRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [showToast]);

  useFocusEffect(
    useCallback(() => {
      load(false);
      refreshVideoMessageUnseenCount?.();
    }, [load, refreshVideoMessageUnseenCount]),
  );

  useEffect(() => {
    if (!socket) return;
    const onNew = (row: any) => {
      if (!row?._id) return;
      setItems((prev) => {
        if (prev.some((x) => String(x._id) === String(row._id))) return prev;
        return [row, ...prev];
      });
    };
    const onNote = (payload: any) => {
      const id = String(payload?.videoMessageId || '');
      if (!id) return;
      setItems((prev) =>
        prev.map((x) =>
          String(x._id) === id
            ? {
                ...x,
                noteCount: (x.noteCount || 0) + 1,
                ...(payload?.badge
                  ? uidOf(x.sender) === String(user?._id)
                    ? { senderHasNewNotes: true, senderUnseenNotes: (x.senderUnseenNotes || 0) + 1 }
                    : { receiverUnseenNotes: (x.receiverUnseenNotes || 0) + 1 }
                  : {}),
              }
            : x,
        ),
      );
    };
    const onDeleted = (payload: any) => {
      const id = String(payload?._id || '');
      if (!id) return;
      setItems((prev) => prev.filter((x) => String(x._id) !== id));
    };
    const onSeen = (payload: any) => {
      const id = String(payload?._id || '');
      if (!id) return;
      setItems((prev) => prev.map((x) => (String(x._id) === id ? { ...x, seenAt: payload.seenAt || new Date().toISOString() } : x)));
    };
    socket.on('videoMessage:new', onNew);
    socket.on('videoMessage:note', onNote);
    socket.on('videoMessage:deleted', onDeleted);
    socket.on('videoMessage:seen', onSeen);
    return () => {
      socket.off('videoMessage:new', onNew);
      socket.off('videoMessage:note', onNote);
      socket.off('videoMessage:deleted', onDeleted);
      socket.off('videoMessage:seen', onSeen);
    };
  }, [socket, user?._id]);

  const loadPeople = useCallback(async (more = false) => {
    const q = query.trim();
    if (q.length < 1) {
      setPeople([]);
      setPeopleMore(false);
      return;
    }
    if (more && (peopleBusyRef.current || !peopleMore)) return;
    const req = ++peopleReqRef.current;
    peopleBusyRef.current = true;
    setPeopleLoading(true);
    const skip = more ? peopleSkipRef.current : 0;
    try {
      const me = String(user?._id || '');
      const followData = await apiService
        .get(`${ENDPOINTS.GET_FOLLOWING}?q=${encodeURIComponent(q)}&limit=8&skip=${skip}`)
        .catch(() => null);
      let list = Array.isArray(followData) ? followData : followData?.users || [];
      if (!more && list.length === 0) {
        const searchData = await apiService
          .get(`${ENDPOINTS.SEARCH_USERS}?search=${encodeURIComponent(q)}`)
          .catch(() => null);
        list = (Array.isArray(searchData) ? searchData : searchData?.users || []).filter(
          (u: any) => u?.isFollowedByMe === true,
        );
      }
      if (req !== peopleReqRef.current) return;
      const page = list.filter((u: any) => String(u?._id || '') && String(u._id) !== me);
      setPeople((prev) => {
        if (!more) return page;
        const seen = new Set(prev.map((x) => String(x._id)));
        const out = [...prev];
        for (const u of page) {
          const id = String(u?._id || '');
          if (id && !seen.has(id)) out.push(u);
        }
        return out;
      });
      setPeopleMore(!!followData?.hasMore);
      peopleSkipRef.current = Number.isFinite(followData?.nextSkip) ? followData.nextSkip : skip + page.length;
    } catch {
      if (!more) setPeople([]);
    } finally {
      if (req === peopleReqRef.current) {
        peopleBusyRef.current = false;
        setPeopleLoading(false);
      }
    }
  }, [query, user?._id, peopleMore]);

  useEffect(() => {
    peopleSkipRef.current = 0;
    if (query.trim().length < 1) {
      setPeople([]);
      setPeopleMore(false);
      return;
    }
    const t = setTimeout(() => {
      loadPeople(false);
    }, 250);
    return () => clearTimeout(t);
  }, [query, user?._id]);

  const pickVideo = async (fromCamera: boolean) => {
    try {
      const res = fromCamera
        ? await launchCamera({ mediaType: 'video', videoQuality: 'low', durationLimit: 180, cameraType: 'front' })
        : await launchImageLibrary({ mediaType: 'video', selectionLimit: 1, videoQuality: 'low' });
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (!asset?.uri) return;
      setPickedAsset(asset);
      setThumbUri('');
      try {
        const thumb = await createThumbnail({
          url: asset.uri,
          timeStamp: 400,
          format: 'jpeg',
          maxWidth: 360,
          maxHeight: 480,
        });
        const path = thumb?.path || '';
        if (path) setThumbUri(path.startsWith('file://') ? path : `file://${path}`);
      } catch {
        setThumbUri('');
      }
    } catch {
      Alert.alert('Error', 'Could not pick video');
    }
  };

  const handleSend = async () => {
    if (!pickedUser?._id || !pickedAsset?.uri || sending) return;
    setSending(true);
    try {
      const duration = getVideoDurationSeconds(pickedAsset) || 0;
      if (duration > 600) {
        showToast('Error', 'Video must be 10 minutes or less', 'error');
        return;
      }
      setSendHint('Uploading video…');
      const lightUri = await shrinkVideoForMessage(pickedAsset.uri);
      let thumbUri = '';
      try {
      const videoUrl = await uploadMediaToR2(
        {
          uri: lightUri,
          type: 'video/mp4',
          fileName: 'video.mp4',
          skipCompress: true,
        },
        'video-messages',
      );
      setSendHint('Almost done…');
      let thumbnailUrl = '';
      try {
        const thumb = await createThumbnail({
          url: pickedAsset.uri,
          timeStamp: 400,
          format: 'jpeg',
          maxWidth: 360,
          maxHeight: 480,
        });
        thumbUri = thumb?.path
          ? thumb.path.startsWith('file://')
            ? thumb.path
            : `file://${thumb.path}`
          : '';
        if (thumbUri) {
          thumbnailUrl = await uploadMediaToR2(
            { uri: thumbUri, type: 'image/jpeg', fileName: 'thumb.jpg', skipCompress: true },
            'video-messages',
          );
        }
      } catch {
        thumbnailUrl = '';
      }
      const data = await apiService.post(ENDPOINTS.VIDEO_MESSAGES, {
        receiverId: pickedUser._id,
        videoUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        duration: Math.round(duration),
      });
      setItems((prev) => [data, ...prev.filter((x) => String(x._id) !== String(data._id))]);
      setSendOpen(false);
      setQuery('');
      setPeople([]);
      setPickedUser(null);
      setPickedAsset(null);
      setThumbUri('');
      showToast('Sent', 'Video message sent', 'success');
      } finally {
        await removeTempVideo(lightUri);
        if (thumbUri) await removeTempVideo(thumbUri);
      }
    } catch (e: any) {
      showToast('Error', e?.message || 'Failed to send', 'error');
    } finally {
      setSending(false);
      setSendHint('');
    }
  };

  const renderItem = ({ item }: { item: any }) => {
    if (!item) return null;
    const other = otherParty(item, user?._id);
    const fresh = unseenAmount(item, user?._id);
    const unseen = fresh > 0;
    const mine = uidOf(item.sender) === String(user?._id);
    return (
      <TouchableOpacity
        style={[
          styles.row,
          { backgroundColor: colors.cardBg, borderColor: unseen ? colors.primary : colors.border },
        ]}
        onPress={() => {
          if (fresh > 0) setVideoMessageUnseenCount((n) => Math.max(0, (n || 0) - fresh));
          navigation.navigate('VideoMessageWatch', { id: String(item._id) });
        }}
      >
        <View style={[styles.thumb, { width: thumbW, height: thumbH, backgroundColor: colors.border }]}>
          <VideoFeedPreview
            videoUrl={mediaDisplayUrl(item.videoUrl)}
            serverThumbnail={item.thumbnailUrl ? mediaDisplayUrl(item.thumbnailUrl) : ''}
            placeholderColor="#111"
            spinnerColor={colors.primary}
            resizeMode="cover"
          />
          <View style={styles.thumbTime}>
            <Text style={styles.thumbTimeText}>{fmtTime(item.duration)}</Text>
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.nameRow}>
            <Text style={[styles.name, { color: colors.text, flex: 1 }]} numberOfLines={1}>
              {other?.name || other?.username || 'User'}
            </Text>
            {unseen ? (
              <View style={[styles.newPill, { backgroundColor: colors.primary }]}>
                <Text style={styles.newPillText}>{fresh > 1 ? fresh : 'New'}</Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: colors.textGray, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
            {mine ? (item.seenAt ? 'Seen' : 'Not opened yet') : 'Sent you'}
          </Text>
          <Text style={{ color: colors.textGray, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
            {item.noteCount || 0} {item.noteCount === 1 ? 'reply' : 'replies'}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.rowDelete}
          onPress={() => {
            Alert.alert('Delete video', 'Delete this video for both of you?', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await apiService.delete(`${ENDPOINTS.VIDEO_MESSAGES}/${item._id}`);
                    setItems((prev) => prev.filter((x) => String(x._id) !== String(item._id)));
                  } catch (e: any) {
                    showToast('Error', e?.message || 'Failed to delete', 'error');
                  }
                },
              },
            ]);
          }}
        >
          <Text style={{ color: '#e11d48', fontWeight: '700', fontSize: 12 }}>Delete</Text>
        </TouchableOpacity>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: headerPad }]}>
      <View style={[styles.topBar, wide.contentCap]}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate('Feed', { screen: 'FeedScreen' });
          }}
        >
          <Text style={[styles.back, { color: colors.text }]}>‹ Back</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text, fontSize: compact ? 16 : 18 }]} numberOfLines={1}>
          Video Messages
        </Text>
        <TouchableOpacity onPress={() => setSendOpen(true)} style={[styles.sendPill, { backgroundColor: colors.primary }]}>
          <Text style={styles.sendPillText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item._id)}
          renderItem={renderItem}
          contentContainerStyle={[{ padding: 12, paddingBottom: 24 + insets.bottom }, wide.contentCap]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(false); }} />
          }
          onEndReached={() => { if (hasMore && !loadingMore) load(true); }}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            <View style={{ paddingTop: 48, alignItems: 'center' }}>
              <Text style={{ fontSize: 28, marginBottom: 8 }}>📹</Text>
              <Text style={{ color: colors.text, fontWeight: '700', marginBottom: 4 }}>No video messages yet</Text>
              <Text style={{ color: colors.textGray, textAlign: 'center' }}>
                Send a video to one person. They can reply on any moment.
              </Text>
            </View>
          }
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.primary} /> : null}
        />
      )}

      <Modal visible={sendOpen} animationType="slide" onRequestClose={() => setSendOpen(false)}>
        <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: headerPad }]}>
          <View style={[styles.topBar, wide.contentCap]}>
            <TouchableOpacity onPress={() => setSendOpen(false)}>
              <Text style={[styles.back, { color: colors.text }]}>Close</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]}>New video</Text>
            <View style={{ width: 64 }} />
          </View>
          <View style={[{ flex: 1, width: '100%' }, wide.contentCap]}>
          {!pickedUser ? (
            <TextInput
              placeholder="Search people you follow"
              placeholderTextColor={colors.textGray}
              value={query}
              onChangeText={setQuery}
              style={[styles.input, { color: colors.text, borderColor: colors.border, backgroundColor: colors.cardBg, marginHorizontal: 16, marginTop: 8 }]}
            />
          ) : null}
          {!pickedUser && query.trim().length > 0 ? (
            <FlatList
              data={people}
              style={{ flex: 1 }}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(p) => String(p._id)}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 + insets.bottom }}
              onEndReached={() => {
                if (peopleMore && !peopleLoading) loadPeople(true);
              }}
              onEndReachedThreshold={0.4}
              ListEmptyComponent={
                peopleLoading ? null : (
                  <Text style={{ color: colors.textGray, padding: 12 }}>No one you follow matches</Text>
                )
              }
              ListFooterComponent={
                peopleLoading ? <ActivityIndicator color={colors.primary} style={{ marginVertical: 8 }} /> : null
              }
              renderItem={({ item: p }) => (
                <TouchableOpacity
                  style={[styles.personCard, { borderColor: colors.border, backgroundColor: colors.cardBg }]}
                  onPress={() => {
                    setPickedUser(p);
                    setPeople([]);
                    setPeopleMore(false);
                    setQuery('');
                  }}
                >
                  {p.profilePic ? (
                    <Image source={{ uri: mediaDisplayUrl(p.profilePic) }} style={styles.avatar} />
                  ) : (
                    <View style={styles.avatar} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                      {p.name || p.username}
                    </Text>
                    {p.username ? (
                      <Text style={{ color: colors.textGray, fontSize: 12 }}>@{p.username}</Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              )}
            />
          ) : (
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ padding: 16, paddingBottom: 24 + insets.bottom }}
          >
            {pickedUser ? (
              <View style={[styles.personCard, { borderColor: colors.border, backgroundColor: colors.cardBg }]}>
                {pickedUser.profilePic ? (
                  <Image source={{ uri: mediaDisplayUrl(pickedUser.profilePic) }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, { backgroundColor: colors.border }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.textGray, fontSize: 12 }}>To</Text>
                  <Text style={{ color: colors.text, fontWeight: '700' }} numberOfLines={1}>
                    {pickedUser.name || pickedUser.username}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setPickedUser(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>Change</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={{ color: colors.textGray, fontSize: 14, marginBottom: 12 }}>
                Search someone you follow, then add a video.
              </Text>
            )}
            {thumbUri || pickedAsset?.uri ? (
              <View style={[styles.previewCard, { backgroundColor: colors.cardBg, borderColor: colors.border }]}>
                {thumbUri ? (
                  <Image source={{ uri: thumbUri }} style={styles.previewImg} />
                ) : (
                  <View style={[styles.previewImg, { backgroundColor: '#111' }]} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>Video ready</Text>
                  <Text style={{ color: colors.textGray, fontSize: 13, marginTop: 4 }}>
                    {fmtTime((pickedAsset && getVideoDurationSeconds(pickedAsset)) || 0)}
                  </Text>
                </View>
              </View>
            ) : null}
            <View style={styles.pickRow}>
              <TouchableOpacity style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.cardBg }]} onPress={() => pickVideo(false)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Gallery</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.btn, { borderColor: colors.border, backgroundColor: colors.cardBg }]} onPress={() => pickVideo(true)}>
                <Text style={{ color: colors.text, fontWeight: '700' }}>Camera</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.primary, opacity: pickedUser && pickedAsset && !sending ? 1 : 0.5 }]}
              disabled={!pickedUser || !pickedAsset || sending}
              onPress={handleSend}
            >
              {sending ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <ActivityIndicator color="#fff" />
                  <Text style={{ color: '#fff', fontWeight: '600' }}>{sendHint || 'Sending…'}</Text>
                </View>
              ) : (
                <Text style={{ color: '#fff', fontWeight: '700' }}>Send</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
          )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingTop: 4,
    paddingBottom: 12,
    width: '100%',
  },
  back: { fontSize: 16, fontWeight: '600', width: 64 },
  title: { flex: 1, textAlign: 'center', fontWeight: '800' },
  sendPill: { minWidth: 64, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 14, alignItems: 'center' },
  sendPillText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  thumb: { borderRadius: 10, overflow: 'hidden' },
  thumbTime: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  thumbTimeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#333' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '700' },
  newPill: { borderRadius: 999, minWidth: 22, paddingHorizontal: 7, paddingVertical: 2, alignItems: 'center' },
  newPillText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  rowDelete: { paddingVertical: 6, paddingLeft: 4 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 12, fontSize: 16 },
  personCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 10,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 4,
  },
  previewImg: { width: 72, height: 96, borderRadius: 12, backgroundColor: '#111' },
  pickRow: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, borderWidth: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 10 },
  sendBtn: { marginTop: 18, borderRadius: 14, paddingVertical: 15, alignItems: 'center' },
});

export default VideoMessagesScreen;
