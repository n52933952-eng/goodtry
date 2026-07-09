/**
 * Full-screen image preview with Instagram-style swipe between images + pinch-to-zoom.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  NativeScrollEvent,
  NativeSyntheticEvent,
  View,
} from 'react-native';
import {
  FlatList,
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  State,
} from 'react-native-gesture-handler';

type Props = {
  visible: boolean;
  uri?: string;
  uris?: string[];
  initialIndex?: number;
  onClose: () => void;
  closeAccessibilityLabel?: string;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

const ZoomableImage: React.FC<{
  uri: string;
  active: boolean;
  slideWidth: number;
  slideHeight: number;
  onZoomedChange?: (zoomed: boolean) => void;
}> = ({ uri, active, slideWidth, slideHeight, onZoomedChange }) => {
  const imageH = slideHeight * 0.82;

  const pinchScale = useRef(new Animated.Value(1)).current;
  const baseScale = useRef(new Animated.Value(1)).current;
  const scale = useMemo(() => Animated.multiply(baseScale, pinchScale), [baseScale, pinchScale]);

  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const offsetX = useRef(new Animated.Value(0)).current;
  const offsetY = useRef(new Animated.Value(0)).current;
  const translateX = useMemo(() => Animated.add(offsetX, panX), [offsetX, panX]);
  const translateY = useMemo(() => Animated.add(offsetY, panY), [offsetY, panY]);

  const baseScaleRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);
  const [isZoomed, setIsZoomed] = useState(false);

  const pinchRef = useRef<PinchGestureHandler>(null);
  const panRef = useRef<PanGestureHandler>(null);

  const notifyZoom = useCallback(
    (nextScale: number) => {
      const zoomed = nextScale > MIN_SCALE + 0.02;
      setIsZoomed(zoomed);
      if (active) onZoomedChange?.(zoomed);
    },
    [active, onZoomedChange],
  );

  const resetTransform = useCallback(() => {
    baseScaleRef.current = 1;
    offsetXRef.current = 0;
    offsetYRef.current = 0;
    baseScale.setValue(1);
    pinchScale.setValue(1);
    offsetX.setValue(0);
    offsetY.setValue(0);
    panX.setValue(0);
    panY.setValue(0);
    setIsZoomed(false);
    if (active) onZoomedChange?.(false);
  }, [active, baseScale, pinchScale, offsetX, offsetY, onZoomedChange, panX, panY]);

  useEffect(() => {
    if (!active) resetTransform();
  }, [active, resetTransform]);

  useEffect(() => {
    resetTransform();
  }, [uri, resetTransform]);

  const onPinchEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { scale: pinchScale } }], {
        useNativeDriver: true,
      }),
    [pinchScale],
  );

  const onPinchStateChange = useCallback(
    (e: { nativeEvent: { oldState: number; scale: number } }) => {
      if (e.nativeEvent.oldState !== State.ACTIVE) return;
      let next = baseScaleRef.current * e.nativeEvent.scale;
      next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
      baseScaleRef.current = next;
      baseScale.setValue(next);
      pinchScale.setValue(1);
      if (next <= MIN_SCALE) {
        offsetXRef.current = 0;
        offsetYRef.current = 0;
        offsetX.setValue(0);
        offsetY.setValue(0);
      }
      notifyZoom(next);
    },
    [baseScale, notifyZoom, offsetX, offsetY, pinchScale],
  );

  const onPanEvent = useMemo(
    () =>
      Animated.event([{ nativeEvent: { translationX: panX, translationY: panY } }], {
        useNativeDriver: true,
      }),
    [panX, panY],
  );

  const onPanStateChange = useCallback(
    (e: { nativeEvent: { oldState: number; translationX: number; translationY: number } }) => {
      if (e.nativeEvent.oldState !== State.ACTIVE) return;
      if (baseScaleRef.current <= MIN_SCALE) {
        panX.setValue(0);
        panY.setValue(0);
        return;
      }
      offsetXRef.current += e.nativeEvent.translationX;
      offsetYRef.current += e.nativeEvent.translationY;
      offsetX.setValue(offsetXRef.current);
      offsetY.setValue(offsetYRef.current);
      panX.setValue(0);
      panY.setValue(0);
    },
    [offsetX, offsetY, panX, panY],
  );

  return (
    <View style={{ width: slideWidth, height: slideHeight }}>
      <PanGestureHandler
        ref={panRef}
        onGestureEvent={onPanEvent}
        onHandlerStateChange={onPanStateChange}
        simultaneousHandlers={pinchRef}
        minPointers={1}
        maxPointers={2}
        enabled={active && isZoomed}
      >
        <Animated.View style={styles.centerStage}>
          <PinchGestureHandler
            ref={pinchRef}
            onGestureEvent={onPinchEvent}
            onHandlerStateChange={onPinchStateChange}
            simultaneousHandlers={panRef}
            enabled={active}
          >
            <Animated.View
              style={{
                transform: [{ translateX }, { translateY }, { scale }],
              }}
            >
              <Image
                source={{ uri }}
                style={{ width: slideWidth, height: imageH }}
                resizeMode="contain"
              />
            </Animated.View>
          </PinchGestureHandler>
        </Animated.View>
      </PanGestureHandler>
    </View>
  );
};

const PinchZoomImageModal: React.FC<Props> = ({
  visible,
  uri,
  uris,
  initialIndex = 0,
  onClose,
  closeAccessibilityLabel = 'Close',
}) => {
  const { width: winW, height: winH } = Dimensions.get('window');

  const list = useMemo(() => {
    const fromList = Array.isArray(uris) ? uris.filter(Boolean) : [];
    if (fromList.length) return fromList;
    return uri ? [uri] : [];
  }, [uris, uri]);

  const [activeIndex, setActiveIndex] = useState(0);
  const [isImageZoomed, setIsImageZoomed] = useState(false);
  const listRef = useRef<FlatList<string>>(null);

  const safeInitialIndex = Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1)));

  useEffect(() => {
    if (!visible) {
      setIsImageZoomed(false);
      return;
    }
    setActiveIndex(safeInitialIndex);
    setIsImageZoomed(false);
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToIndex({ index: safeInitialIndex, animated: false });
      } catch (_) {}
    });
  }, [visible, safeInitialIndex, list.length]);

  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = winW || 1;
    const idx = Math.round((e.nativeEvent.contentOffset.x || 0) / w);
    if (idx >= 0 && idx < list.length) {
      setActiveIndex(idx);
      setIsImageZoomed(false);
    }
  };

  if (!list.length) return null;

  const showPager = list.length > 1;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.root}>
          <FlatList
            ref={listRef}
            style={styles.list}
            data={list}
            horizontal
            pagingEnabled
            bounces={showPager}
            scrollEnabled={showPager && !isImageZoomed}
            showsHorizontalScrollIndicator={false}
            keyExtractor={(u, i) => `${i}-${u}`}
            onMomentumScrollEnd={onMomentumScrollEnd}
            getItemLayout={
              showPager
                ? (_, index) => ({ length: winW, offset: winW * index, index })
                : undefined
            }
            initialScrollIndex={showPager ? safeInitialIndex : undefined}
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                try {
                  listRef.current?.scrollToIndex({ index: info.index, animated: false });
                } catch (_) {}
              }, 50);
            }}
            renderItem={({ item, index }) => (
              <ZoomableImage
                uri={item}
                active={index === activeIndex}
                slideWidth={winW}
                slideHeight={winH}
                onZoomedChange={index === activeIndex ? setIsImageZoomed : undefined}
              />
            )}
          />

          {showPager ? (
            <View style={styles.counter} pointerEvents="none">
              <Text style={styles.counterText}>
                {activeIndex + 1}/{list.length}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
            accessibilityRole="button"
            accessibilityLabel={closeAccessibilityLabel}
          >
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
  },
  list: {
    flex: 1,
  },
  centerStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  counter: {
    position: 'absolute',
    top: 52,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  counterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  closeBtn: {
    position: 'absolute',
    top: 48,
    right: 16,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  closeBtnText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    lineHeight: 24,
  },
});

export default PinchZoomImageModal;
