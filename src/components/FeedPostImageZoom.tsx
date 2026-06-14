import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  PanResponder,
  LayoutChangeEvent,
  StyleProp,
  ViewStyle,
  Animated,
  Easing,
} from 'react-native';
import SafeImage from './SafeImage';
import { useLanguage } from '../context/LanguageContext';
import { useShowToast } from '../hooks/useShowToast';

const ZOOM_MIN = 1;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.12;
const TAP_MOVE_THRESHOLD = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props = {
  uri: string;
  containerStyle?: StyleProp<ViewStyle>;
  onPressImage?: () => void;
};

const FeedPostImageZoom: React.FC<Props> = ({ uri, containerStyle, onPressImage }) => {
  const { t } = useLanguage();
  const showToast = useShowToast();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });

  const zoomRef = useRef(1);
  const vpRef = useRef({ w: 0, h: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const dragMovedRef = useRef(false);
  const showToastRef = useRef(showToast);
  const tRef = useRef(t);
  const hintLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const hintOpacity = useRef(new Animated.Value(0)).current;
  const hintTranslateY = useRef(new Animated.Value(10)).current;
  const hintPulse = useRef(new Animated.Value(1)).current;

  zoomRef.current = zoom;
  vpRef.current = vpSize;
  panRef.current = pan;
  showToastRef.current = showToast;
  tRef.current = t;

  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [uri]);

  const maxPan = useCallback((z: number, w: number, h: number) => ({
    x: (w * (z - 1)) / 2,
    y: (h * (z - 1)) / 2,
  }), []);

  const clampPan = useCallback((x: number, y: number, z: number, w: number, h: number) => {
    const m = maxPan(z, w, h);
    return { x: clamp(x, -m.x, m.x), y: clamp(y, -m.y, m.y) };
  }, [maxPan]);

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 });
    } else {
      setPan((p) => clampPan(p.x, p.y, zoom, vpSize.w, vpSize.h));
    }
  }, [zoom, vpSize.w, vpSize.h, clampPan]);

  useEffect(() => {
    hintLoopRef.current?.stop();

    if (zoom > 1) {
      hintOpacity.setValue(0);
      hintTranslateY.setValue(10);
      hintPulse.setValue(1);

      Animated.parallel([
        Animated.timing(hintOpacity, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(hintTranslateY, {
          toValue: 0,
          duration: 240,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        hintLoopRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(hintPulse, {
              toValue: 0.5,
              duration: 850,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
            Animated.timing(hintPulse, {
              toValue: 1,
              duration: 850,
              easing: Easing.inOut(Easing.ease),
              useNativeDriver: true,
            }),
          ]),
        );
        hintLoopRef.current.start();
      });
    } else {
      hintOpacity.setValue(0);
      hintTranslateY.setValue(10);
      hintPulse.setValue(1);
    }

    return () => {
      hintLoopRef.current?.stop();
    };
  }, [zoom, hintOpacity, hintTranslateY, hintPulse]);

  const onViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setVpSize({ w: width, h: height });
    }
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => zoomRef.current > 1,
        onStartShouldSetPanResponderCapture: () => zoomRef.current > 1,
        onMoveShouldSetPanResponder: (_, g) =>
          zoomRef.current > 1 && (Math.abs(g.dx) > TAP_MOVE_THRESHOLD || Math.abs(g.dy) > TAP_MOVE_THRESHOLD),
        onMoveShouldSetPanResponderCapture: (_, g) =>
          zoomRef.current > 1 && (Math.abs(g.dx) > TAP_MOVE_THRESHOLD || Math.abs(g.dy) > TAP_MOVE_THRESHOLD),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          panStartRef.current = { ...panRef.current };
          dragMovedRef.current = false;
        },
        onPanResponderMove: (_, g) => {
          if (Math.abs(g.dx) > TAP_MOVE_THRESHOLD || Math.abs(g.dy) > TAP_MOVE_THRESHOLD) {
            dragMovedRef.current = true;
          }
          const z = zoomRef.current;
          const { w, h } = vpRef.current;
          setPan(
            clampPan(panStartRef.current.x + g.dx, panStartRef.current.y + g.dy, z, w, h),
          );
        },
        onPanResponderRelease: () => {
          if (!dragMovedRef.current && zoomRef.current > 1) {
            showToastRef.current(
              tRef.current('info') || 'Info',
              tRef.current('feedImageResetZoomToOpen'),
              'info',
            );
          }
        },
      }),
    [clampPan],
  );

  const handleImagePress = useCallback(() => {
    if (zoom > 1) {
      showToast(t('info') || 'Info', t('feedImageResetZoomToOpen'), 'info');
      return;
    }
    onPressImage?.();
  }, [zoom, onPressImage, showToast, t]);

  const zoomIn = useCallback(() => {
    setZoom((z) => clamp(Number((z + ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => clamp(Number((z - ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const stopNav = (fn: () => void) => (e?: { stopPropagation?: () => void }) => {
    e?.stopPropagation?.();
    fn();
  };

  return (
    <View style={[containerStyle, styles.root]}>
      <View style={styles.viewport} onLayout={onViewportLayout}>
        <Pressable style={styles.imagePress} onPress={handleImagePress}>
          <SafeImage
            source={{ uri }}
            style={[
              styles.imageFill,
              zoom > 1 && {
                transform: [
                  { translateX: pan.x },
                  { translateY: pan.y },
                  { scale: zoom },
                ],
              },
            ]}
            resizeMode="contain"
          />
        </Pressable>
        {zoom > 1 && <View style={styles.dragOverlay} {...panResponder.panHandlers} />}
      </View>

      {zoom > 1 && (
        <Animated.View
          style={[
            styles.zoomHint,
            {
              opacity: hintOpacity,
              transform: [{ translateY: hintTranslateY }],
            },
          ]}
          pointerEvents="none"
        >
          <Animated.View style={{ opacity: hintPulse }}>
            <Text style={styles.zoomHintText}>{t('feedImageZoomHint')}</Text>
          </Animated.View>
        </Animated.View>
      )}

      <View style={styles.zoomControls} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.zoomChip}
          onPress={stopNav(zoomOut)}
          disabled={zoom <= ZOOM_MIN}
          activeOpacity={0.85}
        >
          <Text style={[styles.zoomChipText, zoom <= ZOOM_MIN && styles.zoomChipDisabled]}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.zoomChip} onPress={stopNav(resetZoom)} activeOpacity={0.85}>
          <Text style={[styles.zoomChipText, styles.zoomPct]}>{Math.round(zoom * 100)}%</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.zoomChip}
          onPress={stopNav(zoomIn)}
          disabled={zoom >= ZOOM_MAX}
          activeOpacity={0.85}
        >
          <Text style={[styles.zoomChipText, zoom >= ZOOM_MAX && styles.zoomChipDisabled]}>+</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'relative',
    overflow: 'hidden',
  },
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  imagePress: {
    flex: 1,
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  dragOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  zoomControls: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 10,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 30,
  },
  zoomChip: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  zoomChipText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  zoomPct: {
    fontSize: 11,
  },
  zoomChipDisabled: {
    opacity: 0.35,
  },
  zoomHint: {
    position: 'absolute',
    left: 8,
    right: 52,
    bottom: 10,
    zIndex: 25,
    alignItems: 'center',
  },
  zoomHintText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    overflow: 'hidden',
  },
});

export default FeedPostImageZoom;
