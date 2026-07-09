import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleProp,
  ViewStyle,
  LayoutChangeEvent,
  DeviceEventEmitter,
  Animated,
} from 'react-native';
import Sound from 'react-native-sound';
import SafeImage from './SafeImage';
import { useLanguage } from '../context/LanguageContext';
import { mediaDisplayUrl } from '../utils/mediaUrl';
import {
  FEED_VIDEO_PAUSE_ALL,
  FEED_VISIBLE_POSTS,
  FEED_MEDIA_SOUND_PREF,
  FEED_REQUEST_MEDIA_AUTOPLAY,
  isFeedMediaMuted,
  setFeedMediaSoundUnmuted,
} from '../utils/feedVideoPlayback';
import type { PostCarouselSlide } from '../utils/postCarousel';

type Props = {
  slides: PostCarouselSlide[];
  audioUrl?: string | null;
  postId?: string;
  containerStyle?: StyleProp<ViewStyle>;
  slideHeight?: number;
  /** Parent screen focus — stop audio when another screen is on top. */
  screenFocused?: boolean;
  /** Feed: active visible post — autoplay loop muted like video. */
  autoPlayMedia?: boolean;
  /** Collaborative posts — show contributor name on each slide. */
  showContributorNames?: boolean;
  onPressSlide?: () => void;
  onPressImagePreview?: (uri: string, index?: number) => void;
};

let soundCategoryReady = false;

const ensureSoundCategory = () => {
  if (soundCategoryReady) return;
  try {
    Sound.setCategory('Playback', true);
    soundCategoryReady = true;
  } catch (_) {}
};

const PostMediaCarousel: React.FC<Props> = ({
  slides,
  audioUrl,
  postId,
  containerStyle,
  slideHeight = 280,
  screenFocused = true,
  autoPlayMedia = false,
  showContributorNames = false,
  onPressSlide,
  onPressImagePreview,
}) => {
  const { t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [feedSoundPrefTick, setFeedSoundPrefTick] = useState(0);
  const isAudioMuted = useMemo(() => isFeedMediaMuted(), [feedSoundPrefTick]);
  const [audioReady, setAudioReady] = useState(false);
  const soundRef = useRef<Sound | null>(null);
  const soundUrlRef = useRef('');
  const pendingPlaybackRef = useRef<{ play: boolean; muted: boolean } | null>(null);
  const listRef = useRef<FlatList<PostCarouselSlide>>(null);
  const autoPlayMediaRef = useRef(autoPlayMedia);
  autoPlayMediaRef.current = autoPlayMedia;
  const screenFocusedRef = useRef(screenFocused);
  screenFocusedRef.current = screenFocused;

  const displayAudioUrl = useMemo(
    () => (audioUrl ? mediaDisplayUrl(audioUrl) : ''),
    [audioUrl],
  );

  const releaseSound = useCallback(() => {
    const s = soundRef.current;
    soundRef.current = null;
    if (!s) return;
    try {
      s.stop(() => {
        try {
          s.release();
        } catch (_) {}
      });
    } catch (_) {
      try {
        s.release();
      } catch (_) {}
    }
  }, []);

  const applySoundPlayback = useCallback((play: boolean, muted: boolean) => {
    const s = soundRef.current;
    if (!s) {
      pendingPlaybackRef.current = { play, muted };
      return;
    }
    pendingPlaybackRef.current = null;
    try {
      s.setVolume(muted ? 0 : 1);
      if (play) {
        s.play((success) => {
          if (!success) pendingPlaybackRef.current = { play: true, muted };
        });
      } else {
        s.pause();
      }
    } catch (_) {}
  }, []);

  const syncAudioPlayback = useCallback(
    (play: boolean, muted: boolean) => {
      applySoundPlayback(play, muted);
    },
    [applySoundPlayback],
  );

  const stopAudio = useCallback(() => {
    syncAudioPlayback(false, true);
  }, [syncAudioPlayback]);

  const startFocusedPlayback = useCallback(
    (muted?: boolean) => {
      if (!screenFocusedRef.current) return;
      syncAudioPlayback(true, muted ?? isFeedMediaMuted());
    },
    [syncAudioPlayback],
  );

  const toggleMute = useCallback(() => {
    const nextUnmuted = isFeedMediaMuted();
    setFeedMediaSoundUnmuted(nextUnmuted);
    startFocusedPlayback(!nextUnmuted);
  }, [startFocusedPlayback]);

  useEffect(() => {
    ensureSoundCategory();
    setAudioReady(false);
    pendingPlaybackRef.current = null;

    if (!displayAudioUrl) {
      releaseSound();
      soundUrlRef.current = '';
      return undefined;
    }

    if (soundUrlRef.current === displayAudioUrl && soundRef.current) {
      return undefined;
    }

    releaseSound();
    soundUrlRef.current = displayAudioUrl;

    const sound = new Sound(displayAudioUrl, '', (error) => {
      if (error) {
        setAudioReady(false);
        return;
      }
      try {
        sound.setNumberOfLoops(-1);
      } catch (_) {}
      soundRef.current = sound;
      setAudioReady(true);

      const pending = pendingPlaybackRef.current;
      if (pending) {
        applySoundPlayback(pending.play, pending.muted);
        return;
      }

      const muted = isFeedMediaMuted();
      const shouldPlay = autoPlayMediaRef.current && screenFocusedRef.current;
      applySoundPlayback(shouldPlay, muted);
    });

    return () => {
      if (soundRef.current === sound) {
        releaseSound();
        soundUrlRef.current = '';
      }
    };
  }, [displayAudioUrl, postId, releaseSound, applySoundPlayback]);

  useEffect(() => {
    if (!audioReady || !displayAudioUrl) return;
    const muted = isFeedMediaMuted();
    const shouldPlay = autoPlayMedia && screenFocused;
    syncAudioPlayback(shouldPlay, muted);
  }, [autoPlayMedia, screenFocused, audioReady, displayAudioUrl, syncAudioPlayback]);

  useEffect(() => {
    if (!displayAudioUrl || !autoPlayMedia || !screenFocused) return;
    const muted = isFeedMediaMuted();
    startFocusedPlayback(muted);
    const retries = [250, 600, 1200].map((ms) =>
      setTimeout(() => startFocusedPlayback(muted), ms),
    );
    return () => retries.forEach(clearTimeout);
  }, [displayAudioUrl, autoPlayMedia, screenFocused, startFocusedPlayback]);

  useEffect(() => {
    if (!postId) return undefined;
    const pid = String(postId);
    const sub = DeviceEventEmitter.addListener(
      FEED_REQUEST_MEDIA_AUTOPLAY,
      ({ postId: reqId }: { postId?: string }) => {
        if (String(reqId) !== pid) return;
        const muted = isFeedMediaMuted();
        startFocusedPlayback(muted);
        [300, 900, 1800].forEach((ms) => {
          setTimeout(() => startFocusedPlayback(muted), ms);
        });
      },
    );
    return () => sub.remove();
  }, [postId, startFocusedPlayback]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      FEED_MEDIA_SOUND_PREF,
      () => {
        setFeedSoundPrefTick((t) => t + 1);
        if (screenFocusedRef.current && audioReady && autoPlayMediaRef.current) {
          syncAudioPlayback(true, isFeedMediaMuted());
        }
      },
    );
    return () => sub.remove();
  }, [audioReady, syncAudioPlayback]);

  useEffect(() => {
    if (!screenFocused) stopAudio();
  }, [screenFocused, stopAudio]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FEED_VIDEO_PAUSE_ALL, stopAudio);
    return () => sub.remove();
  }, [stopAudio]);

  useEffect(() => {
    if (!postId) return undefined;
    const pid = String(postId);
    const sub = DeviceEventEmitter.addListener(FEED_VISIBLE_POSTS, (ids: string[]) => {
      const list = Array.isArray(ids) ? ids : [];
      if (list.length > 0 && !list.includes(pid)) stopAudio();
    });
    return () => sub.remove();
  }, [postId, stopAudio]);

  useEffect(() => () => releaseSound(), [releaseSound]);

  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const badgeTranslateY = useRef(new Animated.Value(10)).current;
  const badgeIndexRef = useRef(0);
  const badgeDidMountRef = useRef(false);

  const activeSlide = slides[activeIndex];
  const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  const rawName = (activeSlide?.name || '').trim();
  const rawUsername = (activeSlide?.username || '').trim();
  const contributorName =
    rawName && !looksLikeEmail(rawName)
      ? rawName
      : rawUsername && !looksLikeEmail(rawUsername)
        ? rawUsername.replace(/^@/, '')
        : '';
  const showContributorBadge =
    showContributorNames && !!(contributorName || activeSlide?.profilePic);

  const runBadgeIn = useCallback(() => {
    badgeOpacity.setValue(0);
    badgeTranslateY.setValue(10);
    Animated.parallel([
      Animated.timing(badgeOpacity, {
        toValue: 1,
        duration: 240,
        useNativeDriver: true,
      }),
      Animated.spring(badgeTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 88,
        friction: 10,
      }),
    ]).start();
  }, [badgeOpacity, badgeTranslateY]);

  useEffect(() => {
    if (!showContributorBadge) return;
    if (!badgeDidMountRef.current) {
      badgeDidMountRef.current = true;
      badgeIndexRef.current = activeIndex;
      runBadgeIn();
      return;
    }
    if (badgeIndexRef.current === activeIndex) return;
    badgeIndexRef.current = activeIndex;
    runBadgeIn();
  }, [activeIndex, showContributorBadge, runBadgeIn]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== layoutWidth) setLayoutWidth(w);
  };

  const updateIndexFromOffset = (offsetX: number) => {
    const w = layoutWidth || 1;
    const i = Math.round(offsetX / w);
    if (i >= 0 && i < slides.length) setActiveIndex(i);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    updateIndexFromOffset(e.nativeEvent.contentOffset.x);
  };

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    updateIndexFromOffset(e.nativeEvent.contentOffset.x);
  };

  if (!slides.length) return null;

  const slideW = layoutWidth > 0 ? layoutWidth : undefined;
  const showSlideCounter = slides.length > 1;

  return (
    <View style={[styles.root, containerStyle]} onLayout={onLayout}>
      <FlatList
        ref={listRef}
        style={styles.list}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.key}
        onScroll={onScroll}
        onMomentumScrollEnd={onMomentumScrollEnd}
        scrollEventThrottle={16}
        getItemLayout={
          slideW
            ? (_, index) => ({ length: slideW, offset: slideW * index, index })
            : undefined
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => {
              if (onPressImagePreview) onPressImagePreview(item.img, index);
              else if (onPressSlide) onPressSlide();
            }}
            disabled={!onPressSlide && !onPressImagePreview}
            style={[styles.slide, slideW ? { width: slideW, height: slideHeight } : { height: slideHeight }]}
          >
            <SafeImage
              source={{ uri: mediaDisplayUrl(item.img) }}
              style={styles.image}
              resizeMode="contain"
            />
          </TouchableOpacity>
        )}
      />

      {showContributorBadge ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.contributorBadge,
            {
              opacity: badgeOpacity,
              transform: [{ translateY: badgeTranslateY }],
            },
          ]}
        >
          {activeSlide?.profilePic ? (
            <SafeImage
              source={{ uri: mediaDisplayUrl(activeSlide.profilePic) }}
              style={styles.contributorAvatar}
            />
          ) : (
            <View style={styles.contributorAvatarFallback}>
              <Text style={styles.contributorAvatarLetter}>
                {contributorName.charAt(0).toUpperCase() || '?'}
              </Text>
            </View>
          )}
          {contributorName ? (
            <Text style={styles.contributorName} numberOfLines={1}>
              {contributorName}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}

      {showSlideCounter ? (
        <View style={styles.slideCounter} pointerEvents="none">
          <Text style={styles.slideCounterText}>
            {activeIndex + 1}/{slides.length}
          </Text>
        </View>
      ) : null}

      {onPressImagePreview ? (
        <TouchableOpacity
          style={styles.expandButton}
          onPress={(e) => {
            e?.stopPropagation?.();
            const uri = slides[activeIndex]?.img;
            if (uri) onPressImagePreview(uri, activeIndex);
          }}
          activeOpacity={0.85}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityRole="button"
          accessibilityLabel={t('viewFullImage')}
        >
          <Text style={styles.expandButtonText}>⛶</Text>
        </TouchableOpacity>
      ) : null}

      {audioUrl ? (
        <TouchableOpacity
          style={styles.muteButton}
          onPress={(e) => {
            e?.stopPropagation?.();
            toggleMute();
          }}
          activeOpacity={0.85}
          hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
          accessibilityRole="button"
          accessibilityLabel={isAudioMuted ? 'Unmute music' : 'Mute music'}
        >
          <Text style={styles.muteButtonText}>{isAudioMuted ? '🔇' : '🔊'}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'relative',
  },
  list: {
    flexGrow: 0,
  },
  slide: {
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  contributorBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '58%',
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 22,
    zIndex: 10,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
  },
  contributorAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  contributorAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginRight: 8,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  contributorAvatarLetter: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  contributorName: {
    flexShrink: 1,
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  slideCounter: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    zIndex: 9,
    elevation: 9,
  },
  slideCounterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  expandButton: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.52)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
    zIndex: 21,
    elevation: 21,
  },
  expandButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 20,
  },
  muteButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    elevation: 20,
  },
  muteButtonText: {
    fontSize: 16,
    color: '#fff',
  },
});

export default PostMediaCarousel;
