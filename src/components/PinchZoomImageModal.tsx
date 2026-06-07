/**
 * Full-screen image preview with Instagram-style pinch-to-zoom and pan when zoomed.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  GestureHandlerRootView,
  PanGestureHandler,
  PinchGestureHandler,
  State,
} from 'react-native-gesture-handler';

type Props = {
  visible: boolean;
  uri: string;
  onClose: () => void;
  closeAccessibilityLabel?: string;
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

const PinchZoomImageModal: React.FC<Props> = ({
  visible,
  uri,
  onClose,
  closeAccessibilityLabel = 'Close',
}) => {
  const { width: winW, height: winH } = Dimensions.get('window');
  const imageH = winH * 0.82;

  const pinchScale = useRef(new Animated.Value(1)).current;
  const baseScale = useRef(new Animated.Value(1)).current;
  const scale = Animated.multiply(baseScale, pinchScale);

  const panX = useRef(new Animated.Value(0)).current;
  const panY = useRef(new Animated.Value(0)).current;
  const offsetX = useRef(new Animated.Value(0)).current;
  const offsetY = useRef(new Animated.Value(0)).current;
  const translateX = Animated.add(offsetX, panX);
  const translateY = Animated.add(offsetY, panY);

  const baseScaleRef = useRef(1);
  const offsetXRef = useRef(0);
  const offsetYRef = useRef(0);

  const pinchRef = useRef<PinchGestureHandler>(null);
  const panRef = useRef<PanGestureHandler>(null);

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
  }, [baseScale, pinchScale, offsetX, offsetY, panX, panY]);

  useEffect(() => {
    if (!visible) resetTransform();
  }, [visible, resetTransform]);

  const onPinchEvent = Animated.event([{ nativeEvent: { scale: pinchScale } }], {
    useNativeDriver: true,
  });

  const onPinchStateChange = (e: { nativeEvent: { oldState: number; scale: number } }) => {
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
  };

  const onPanEvent = Animated.event(
    [{ nativeEvent: { translationX: panX, translationY: panY } }],
    { useNativeDriver: true },
  );

  const onPanStateChange = (e: { nativeEvent: { oldState: number; translationX: number; translationY: number } }) => {
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
  };

  const handleBackdropPress = () => {
    if (baseScaleRef.current <= MIN_SCALE + 0.01) onClose();
  };

  if (!uri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.root}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={handleBackdropPress}
            accessibilityRole="button"
            accessibilityLabel={closeAccessibilityLabel}
          />
          <PanGestureHandler
            ref={panRef}
            onGestureEvent={onPanEvent}
            onHandlerStateChange={onPanStateChange}
            simultaneousHandlers={pinchRef}
            minPointers={1}
            maxPointers={2}
          >
            <Animated.View style={styles.centerStage}>
              <PinchGestureHandler
                ref={pinchRef}
                onGestureEvent={onPinchEvent}
                onHandlerStateChange={onPinchStateChange}
                simultaneousHandlers={panRef}
              >
                <Animated.View
                  style={{
                    transform: [{ translateX }, { translateY }, { scale }],
                  }}
                >
                  <Image
                    source={{ uri }}
                    style={{ width: winW, height: imageH }}
                    resizeMode="contain"
                  />
                </Animated.View>
              </PinchGestureHandler>
            </Animated.View>
          </PanGestureHandler>
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
    justifyContent: 'center',
  },
  centerStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
