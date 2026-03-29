import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Dimensions,
  Modal,
  FlatList,
  ActivityIndicator,
  Animated,
  Platform,
  Alert,
  GestureResponderEvent,
  DeviceEventEmitter,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import { apiService } from '../../services/api';
import { ENDPOINTS, STORY_STRIP_SHOULD_REFRESH } from '../../utils/constants';
import { useTheme } from '../../context/ThemeContext';

const { width: W, height: H } = Dimensions.get('window');

const STORY_TAP_NAV_MS = 280;
const STORY_TAP_LEFT_FRAC = 0.35;
const STORY_TAP_RIGHT_FRAC = 0.65;

type Slide = {
  type: 'image' | 'video';
  url: string;
  durationSec?: number;
};

type Props = { route: { params?: { userId: string } }; navigation: any };

const StoryViewerScreen: React.FC<Props> = ({ route, navigation }) => {
  const userId = route.params?.userId;
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [story, setStory] = useState<any>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [viewers, setViewers] = useState<any[]>([]);
  const [viewersOpen, setViewersOpen] = useState(false);

  const [index, setIndex] = useState(0);
  const slides: Slide[] = story?.slides || [];
  const slide = slides[index];

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;
  /** Image slide: total duration for current slide (ms) */
  const imageDurMsRef = useRef(5000);
  const pressStartedAtRef = useRef(0);
  const pausedRemainingMsRef = useRef<number | null>(null);
  const pauseEpochRef = useRef(0);
  const goNextRef = useRef<() => void>(() => {});

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const deleteMine = useCallback(() => {
    Alert.alert('Delete story?', 'Remove your story for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await apiService.delete(ENDPOINTS.STORY_DELETE_MINE);
            navigation.goBack();
          } catch (e: any) {
            Alert.alert('Error', e?.message || 'Failed');
          }
        },
      },
    ]);
  }, [navigation]);

  const load = useCallback(async () => {
    if (!userId) {
      setErr('Missing user');
      setLoading(false);
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const data = await apiService.get(`${ENDPOINTS.STORY_BY_USER}/${userId}`);
      setStory(data.story);
      setIsOwner(!!data.isOwner);
      setViewers(data.viewers || []);
      setIndex(0);
    } catch (e: any) {
      setErr(e?.message || 'No story');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return () => {
      DeviceEventEmitter.emit(STORY_STRIP_SHOULD_REFRESH);
    };
  }, []);

  const goNext = useCallback(() => {
    pauseEpochRef.current += 1;
    pausedRemainingMsRef.current = null;
    clearTimer();
    progressAnim.setValue(0);
    if (index >= slides.length - 1) {
      navigation.goBack();
      return;
    }
    setIndex((i) => i + 1);
  }, [index, slides.length, navigation, progressAnim]);

  goNextRef.current = goNext;

  const goPrev = useCallback(() => {
    pauseEpochRef.current += 1;
    pausedRemainingMsRef.current = null;
    clearTimer();
    progressAnim.setValue(0);
    if (index <= 0) return;
    setIndex((i) => i - 1);
  }, [index, progressAnim]);

  const pauseImageStory = useCallback(() => {
    if (slide?.type !== 'image') return;
    clearTimer();
    pausedRemainingMsRef.current = null;
    const epoch = pauseEpochRef.current;
    progressAnim.stopAnimation((value) => {
      if (epoch !== pauseEpochRef.current) return;
      const v = Math.min(1, Math.max(0, typeof value === 'number' ? value : 0));
      pausedRemainingMsRef.current = Math.max(0, imageDurMsRef.current * (1 - v));
    });
  }, [slide?.type, progressAnim]);

  const resumeImageStory = useCallback(() => {
    if (slide?.type !== 'image') return;
    const fromPause = pausedRemainingMsRef.current;
    pausedRemainingMsRef.current = null;

    const run = (remaining: number) => {
      if (remaining <= 50) {
        goNextRef.current();
        return;
      }
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: remaining,
        useNativeDriver: false,
      }).start();
      timerRef.current = setTimeout(() => goNextRef.current(), remaining);
    };

    if (fromPause !== null && fromPause !== undefined) {
      run(fromPause);
      return;
    }
    progressAnim.stopAnimation((value) => {
      const v = Math.min(1, Math.max(0, typeof value === 'number' ? value : 0));
      run(Math.max(0, imageDurMsRef.current * (1 - v)));
    });
  }, [slide?.type, progressAnim]);

  // Image: timed advance (hold to pause like Instagram); video: WebView `ended` + progress bar from durationSec
  useEffect(() => {
    pauseEpochRef.current += 1;
    pausedRemainingMsRef.current = null;
    clearTimer();
    progressAnim.setValue(0);
    if (!slide) return;

    if (slide.type === 'image') {
      const durMs = Math.min(Math.max((slide.durationSec || 5) * 1000, 2000), 15000);
      imageDurMsRef.current = durMs;
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: durMs,
        useNativeDriver: false,
      }).start();
      timerRef.current = setTimeout(() => goNextRef.current(), durMs);
    } else {
      const durMs = Math.min(Math.max((slide.durationSec || 15) * 1000, 3000), 21000);
      Animated.timing(progressAnim, {
        toValue: 1,
        duration: durMs,
        useNativeDriver: false,
      }).start();
    }

    return () => clearTimer();
  }, [slide, index, progressAnim]);

  const onVideoEnd = useCallback(() => {
    goNext();
  }, [goNext]);

  const onImageHoldPressIn = useCallback(() => {
    pressStartedAtRef.current = Date.now();
    pauseImageStory();
  }, [pauseImageStory]);

  const onImageHoldPressOut = useCallback(
    (e: GestureResponderEvent) => {
      if (slide?.type !== 'image') return;
      const heldMs = Date.now() - pressStartedAtRef.current;
      const x = e.nativeEvent.locationX;
      if (heldMs < STORY_TAP_NAV_MS) {
        if (x < W * STORY_TAP_LEFT_FRAC) {
          goPrev();
          return;
        }
        if (x > W * STORY_TAP_RIGHT_FRAC) {
          goNext();
          return;
        }
      }
      resumeImageStory();
    },
    [slide?.type, goPrev, goNext, resumeImageStory],
  );

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: '#000' }]}>
        <ActivityIndicator color="#fff" size="large" />
      </View>
    );
  }

  if (err || !story || !slides.length) {
    return (
      <View style={[styles.center, { backgroundColor: '#000', padding: 24 }]}>
        <Text style={{ color: '#fff', textAlign: 'center', marginBottom: 16 }}>{err || 'No story'}</Text>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const uname = story.user?.username || 'user';

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.topBarScrim}>
          <View style={styles.progressRow}>
            {slides.map((_, i) => (
              <View key={i} style={styles.progressTrack}>
                {i < index ? (
                  <View style={[styles.progressFill, { width: '100%' }]} />
                ) : i === index ? (
                  <Animated.View
                    style={[
                      styles.progressFill,
                      {
                        width: progressAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['0%', '100%'],
                        }),
                      },
                    ]}
                  />
                ) : null}
              </View>
            ))}
          </View>
          <View style={styles.headerRow}>
            <Text style={[styles.headerName, styles.headerTextShadow]} numberOfLines={1}>
              @{uname}
            </Text>
            {isOwner && (
              <>
                <TouchableOpacity
                  onPress={() => setViewersOpen(true)}
                  style={[styles.headerChip, { marginLeft: 10 }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.headerChipText}>{viewers.length} viewers</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={deleteMine}
                  style={[styles.headerChip, styles.headerChipDanger, { marginLeft: 8 }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.headerChipText}>Delete</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              hitSlop={12}
              style={styles.headerCloseHit}
              activeOpacity={0.7}
            >
              <Text style={[styles.closeX, styles.headerTextShadow]}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <View style={styles.mediaWrap}>
        {slide.type === 'image' ? (
          <>
            <Image source={{ uri: slide.url }} style={styles.media} resizeMode="cover" />
            <Pressable
              style={styles.imageHoldOverlay}
              onPressIn={onImageHoldPressIn}
              onPressOut={onImageHoldPressOut}
            />
          </>
        ) : (
          <>
            <StoryVideo uri={slide.url} onEnded={onVideoEnd} />
            <TouchableOpacity style={styles.tapLeft} activeOpacity={1} onPress={goPrev} />
            <TouchableOpacity style={styles.tapRight} activeOpacity={1} onPress={goNext} />
          </>
        )}
      </View>

      <Modal visible={viewersOpen} transparent animationType="slide" onRequestClose={() => setViewersOpen(false)}>
        <View style={[styles.modalBg, { paddingTop: insets.top }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundLight }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Viewers</Text>
              <TouchableOpacity onPress={() => setViewersOpen(false)}>
                <Text style={{ color: colors.primary, fontSize: 16 }}>Done</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={viewers}
              keyExtractor={(item: any, i) => String(item.user?._id || item.user || i)}
              renderItem={({ item }: any) => {
                const u = item.user;
                const label = u?.name || u?.username || '?';
                return (
                  <View style={styles.viewerRow}>
                    {u?.profilePic ? (
                      <Image source={{ uri: u.profilePic }} style={styles.viewerAv} />
                    ) : (
                      <View style={[styles.viewerAv, { backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                        <Text style={{ color: '#fff', fontWeight: '700' }}>{label[0]}</Text>
                      </View>
                    )}
                    <Text style={[styles.viewerName, { color: colors.text }]}>{label}</Text>
                    <Text style={{ color: colors.textGray, marginLeft: 'auto', fontSize: 12 }}>
                      @{u?.username || ''}
                    </Text>
                  </View>
                );
              }}
              ListEmptyComponent={<Text style={{ color: colors.textGray, padding: 16 }}>No views yet</Text>}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
};

function StoryVideo({ uri, onEnded }: { uri: string; onEnded: () => void }) {
  const safe = encodeURI(uri);
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
<body style="margin:0;background:#000;">
<video id="v" playsinline webkit-playsinline style="width:100vw;height:100vh;object-fit:contain" src="${safe}"></video>
<script>
(function(){
  var v=document.getElementById('v');
  v.muted=true;
  v.play().catch(function(){});
  v.addEventListener('ended',function(){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage('end'); });
})();
</script>
</body></html>`;

  return (
    <WebView
      style={styles.media}
      originWhitelist={['*']}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
      mixedContentMode="always"
      source={{ html }}
      onMessage={(e) => {
        if (e.nativeEvent.data === 'end') onEnded();
      }}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 },
  /** Dark band behind progress + header so links stay readable on bright story frames */
  topBarScrim: {
    backgroundColor: 'rgba(0,0,0,0.52)',
    paddingBottom: 10,
  },
  progressRow: { flexDirection: 'row', gap: 4, paddingHorizontal: 8 },
  progressTrack: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.35)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#fff',
    borderRadius: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    marginTop: 10,
  },
  headerName: { color: '#fff', fontWeight: '700', fontSize: 15, maxWidth: W * 0.38 },
  headerTextShadow: {
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  headerChip: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  headerChipDanger: {
    backgroundColor: 'rgba(185,28,28,0.72)',
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerChipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  headerCloseHit: { padding: 4, marginRight: 2 },
  closeX: { color: '#fff', fontSize: 22, fontWeight: '300' },
  mediaWrap: {
    flex: 1,
    width: W,
    height: H,
    justifyContent: 'center',
    alignItems: 'center',
  },
  media: { width: W, height: H, backgroundColor: '#000' },
  imageHoldOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  tapLeft: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: W * 0.35,
    height: H,
    zIndex: 5,
  },
  tapRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: W * 0.35,
    height: H,
    zIndex: 5,
  },
  closeBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: '#333',
    borderRadius: 8,
  },
  modalBg: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    maxHeight: H * 0.55,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: Platform.OS === 'ios' ? 34 : 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#333',
  },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  viewerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  viewerAv: { width: 40, height: 40, borderRadius: 20, marginRight: 12 },
  viewerName: { fontSize: 16, fontWeight: '600' },
});

export default StoryViewerScreen;
