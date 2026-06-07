/**
 * Draggable host camera pip with +/- resize while screen sharing.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, PanResponder, Animated, useWindowDimensions,
  TouchableOpacity,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView } from '@livekit/react-native';
import type { LocalTrack } from 'livekit-client';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import { PIP_DEFAULT_SIZE_INDEX, clampPipPosition } from '../utils/liveCameraPipLayout';
import { getScaledPipSizeSteps, s, useLiveScreenMetrics } from '../utils/liveScreenLayout';

type Props = {
  track: LocalTrack;
  visible?: boolean;
  onClose?: () => void;
  zIndex?: number;
  /** Extra offset below status bar (e.g. clear End button on live screen) */
  topInsetExtra?: number;
};

const HostCameraPipOverlay = ({
  track, visible = true, onClose, zIndex = 9997, topInsetExtra = 0,
}: Props) => {
  const { flipCamera } = useLiveBroadcast();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const metrics = useLiveScreenMetrics();
  const pipSteps = useMemo(() => getScaledPipSizeSteps(metrics.scale), [metrics.scale]);
  const [sizeIndex, setSizeIndex] = useState(PIP_DEFAULT_SIZE_INDEX);

  const { w: pipW, h: pipH } = pipSteps[sizeIndex] ?? pipSteps[PIP_DEFAULT_SIZE_INDEX];
  const defaultX = winW - pipW - s(12, metrics.scale);
  const defaultY = Math.max(insets.top, 12) + s(52, metrics.scale) + topInsetExtra;

  const pan = useRef(new Animated.ValueXY({ x: defaultX, y: defaultY })).current;
  const sizeRef = useRef({ pipW, pipH });
  sizeRef.current = { pipW, pipH };

  const clampAndSet = useCallback((x: number, y: number) => {
    const { pipW: w, pipH: h } = sizeRef.current;
    const p = clampPipPosition(x, y, w, h, winW, winH, insets.top, metrics.pipBottomPad);
    pan.setValue(p);
  }, [pan, winW, winH, insets.top, metrics.pipBottomPad]);

  useEffect(() => {
    if (!visible) return;
    // @ts-expect-error Animated internal value
    clampAndSet(pan.x._value ?? defaultX, pan.y._value ?? defaultY);
  }, [visible, pipW, pipH, winW, winH, defaultX, defaultY, clampAndSet, pan]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({
          // @ts-expect-error Animated internal value
          x: pan.x._value,
          // @ts-expect-error Animated internal value
          y: pan.y._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event(
        [null, { dx: pan.x, dy: pan.y }],
        { useNativeDriver: false },
      ),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // @ts-expect-error Animated internal value
        clampAndSet(pan.x._value, pan.y._value);
      },
    }),
    [pan, clampAndSet],
  );

  const shrink = () => setSizeIndex((i) => Math.max(0, i - 1));
  const grow = () => setSizeIndex((i) => Math.min(pipSteps.length - 1, i + 1));

  if (!visible || !track) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          width: pipW,
          height: pipH,
          transform: pan.getTranslateTransform(),
          zIndex,
          elevation: zIndex,
        },
      ]}
    >
      <TouchableOpacity
        style={styles.flipBtn}
        onPress={() => { void flipCamera(); }}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityLabel="Flip camera"
      >
        <Text style={styles.flipBtnText}>🔄</Text>
      </TouchableOpacity>
      {onClose ? (
        <TouchableOpacity
          style={styles.closeBtn}
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Hide camera preview"
        >
          <Text style={styles.closeBtnText}>×</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.dragArea} collapsable={false} {...panResponder.panHandlers}>
        <VideoView
          key={track.sid || 'host-pip'}
          videoTrack={track}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror
          zOrder={10}
          pointerEvents="none"
        />
      </View>
      <View style={styles.sizeBar} pointerEvents="box-none">
        <TouchableOpacity
          style={[styles.sizeBtn, sizeIndex === 0 && styles.sizeBtnDisabled]}
          onPress={shrink}
          disabled={sizeIndex === 0}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
        >
          <Text style={styles.sizeBtnText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.sizeBtn, sizeIndex === pipSteps.length - 1 && styles.sizeBtnDisabled]}
          onPress={grow}
          disabled={sizeIndex === pipSteps.length - 1}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
        >
          <Text style={styles.sizeBtnText}>+</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  dragArea: { flex: 1 },
  flipBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 12,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flipBtnText: { fontSize: 15 },
  closeBtn: {
    position: 'absolute',
    top: 4,
    left: 4,
    zIndex: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20, marginTop: -2 },
  sizeBar: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    flexDirection: 'row',
    gap: 4,
  },
  sizeBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sizeBtnDisabled: { opacity: 0.35 },
  sizeBtnText: { color: '#fff', fontSize: 18, fontWeight: '700', lineHeight: 20 },
});

export default HostCameraPipOverlay;
