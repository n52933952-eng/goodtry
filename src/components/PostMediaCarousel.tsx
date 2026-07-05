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
} from 'react-native';
import { WebView } from 'react-native-webview';
import SafeImage from './SafeImage';
import { mediaDisplayUrl } from '../utils/mediaUrl';
import { FEED_VIDEO_PAUSE_ALL, FEED_VISIBLE_POSTS } from '../utils/feedVideoPlayback';
import type { PostCarouselSlide } from '../utils/postCarousel';

type Props = {
  slides: PostCarouselSlide[];
  audioUrl?: string | null;
  postId?: string;
  containerStyle?: StyleProp<ViewStyle>;
  slideHeight?: number;
  /** Parent screen focus — stop audio when another screen is on top. */
  screenFocused?: boolean;
  onPressSlide?: () => void;
  onPressImagePreview?: (uri: string) => void;
};

const escapeHtmlAttr = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const PostMediaCarousel: React.FC<Props> = ({
  slides,
  audioUrl,
  postId,
  containerStyle,
  slideHeight = 280,
  screenFocused = true,
  onPressSlide,
  onPressImagePreview,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [audioPlaying, setAudioPlaying] = useState(false);
  const [audioReady, setAudioReady] = useState(false);
  const audioWebViewRef = useRef<WebView>(null);
  const listRef = useRef<FlatList<PostCarouselSlide>>(null);

  const displayAudioUrl = useMemo(
    () => (audioUrl ? mediaDisplayUrl(audioUrl) : ''),
    [audioUrl],
  );

  const audioHtml = useMemo(() => {
    if (!displayAudioUrl) return null;
    const src = escapeHtmlAttr(displayAudioUrl);
    return `<!DOCTYPE html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin:0;background:transparent;">
    <audio id="a" loop preload="auto" playsinline src="${src}"></audio>
    <script>
      (function () {
        var a = document.getElementById('a');
        if (!a) return;
        function send(name) {
          window.ReactNativeWebView && window.ReactNativeWebView.postMessage(name);
        }
        a.addEventListener('canplay', function () { send('ready'); });
        a.addEventListener('loadeddata', function () { send('ready'); });
        a.addEventListener('error', function () { send('error'); });
        a.addEventListener('playing', function () { send('playing'); });
        a.addEventListener('pause', function () { send('paused'); });
      })();
    </script>
  </body>
</html>`;
  }, [displayAudioUrl]);

  const stopAudio = useCallback(() => {
    try {
      audioWebViewRef.current?.injectJavaScript(`
        (function () {
          var a = document.getElementById('a');
          if (!a) return;
          try { a.pause(); a.muted = true; } catch (_) {}
        })();
        true;
      `);
    } catch (_) {}
    setAudioPlaying(false);
  }, []);

  const toggleAudio = useCallback(() => {
    if (!audioReady) return;
    try {
      audioWebViewRef.current?.injectJavaScript(`
        (function () {
          var a = document.getElementById('a');
          if (!a) return;
          if (a.paused) {
            a.muted = false;
            a.volume = 1;
            var p = a.play();
            if (p && p.catch) p.catch(function () {});
          } else {
            a.pause();
          }
        })();
        true;
      `);
    } catch (_) {}
  }, [audioReady]);

  useEffect(() => {
    setAudioReady(false);
    setAudioPlaying(false);
  }, [displayAudioUrl]);

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

  useEffect(() => {
    return () => {
      try {
        audioWebViewRef.current?.injectJavaScript(`
          (function () {
            var a = document.getElementById('a');
            if (!a) return;
            try { a.pause(); a.muted = true; a.removeAttribute('src'); a.load(); } catch (_) {}
          })();
          true;
        `);
        audioWebViewRef.current?.stopLoading?.();
      } catch (_) {}
    };
  }, [displayAudioUrl]);

  const onAudioMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    const msg = String(event.nativeEvent.data || '');
    if (msg === 'ready') setAudioReady(true);
    if (msg === 'playing') setAudioPlaying(true);
    if (msg === 'paused') setAudioPlaying(false);
    if (msg === 'error') {
      setAudioReady(false);
      setAudioPlaying(false);
    }
  }, []);

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
  const showContributorBadge = !!(slides[activeIndex]?.name || slides[activeIndex]?.username);

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
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => {
              if (onPressImagePreview) onPressImagePreview(item.img);
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
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText} numberOfLines={1}>
            {slides[activeIndex].name || slides[activeIndex].username}
          </Text>
        </View>
      ) : null}

      {showSlideCounter ? (
        <View style={[styles.slideCounter, audioUrl ? styles.slideCounterWithAudio : null]} pointerEvents="none">
          <Text style={styles.slideCounterText}>
            {activeIndex + 1}/{slides.length}
          </Text>
        </View>
      ) : null}

      {audioUrl && audioHtml ? (
        <>
          <WebView
            ref={audioWebViewRef}
            source={{ html: audioHtml }}
            style={styles.audioWebView}
            mediaPlaybackRequiresUserAction={false}
            allowsInlineMediaPlayback
            javaScriptEnabled
            domStorageEnabled
            scrollEnabled={false}
            onMessage={onAudioMessage}
          />
          <TouchableOpacity
            style={[styles.audioBtn, !audioReady && styles.audioBtnDisabled]}
            onPress={toggleAudio}
            activeOpacity={0.85}
            disabled={!audioReady}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityRole="button"
            accessibilityLabel={audioPlaying ? 'Pause music' : 'Play music'}
          >
            <Text style={styles.audioBtnText}>{audioPlaying ? '🔊' : '🔇'}</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {slides.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
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
  audioWebView: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    top: 0,
    left: 0,
  },
  badge: {
    position: 'absolute',
    top: 12,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    maxWidth: '55%',
    zIndex: 8,
    elevation: 8,
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  slideCounter: {
    position: 'absolute',
    top: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    zIndex: 9,
    elevation: 9,
  },
  slideCounterWithAudio: {
    right: 52,
  },
  slideCounterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  audioBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.62)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
    elevation: 10,
  },
  audioBtnDisabled: {
    opacity: 0.45,
  },
  audioBtnText: {
    fontSize: 18,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
  dotActive: {
    backgroundColor: '#3897f0',
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});

export default PostMediaCarousel;
