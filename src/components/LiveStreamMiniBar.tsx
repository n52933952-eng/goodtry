/**
 * Floating bar while the host is live but left the broadcast screen (app home / games).
 * Starts above the tab bar; draggable anywhere on screen.
 */

import React, { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, PanResponder, Animated, useWindowDimensions,
  DeviceEventEmitter, InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import { useTheme } from '../context/ThemeContext';
import { liveBroadcastNav } from '../services/liveBroadcastNav';
import { clampMiniBarPosition } from '../utils/liveMiniBarLayout';
import { LIVE_BAR_RESIGN_GAME } from '../utils/constants';

const BAR_HEIGHT = 56;
const H_MARGIN = 10;
const END_BTN_W = 64;
const ROW_GAP = 8;
const DRAG_THRESHOLD = 6;

const LiveStreamMiniBar = () => {
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const { colors } = useTheme();
  const {
    isLive, isMinimized, isSharing, viewerCount, hostPipVisible,
    returnToLiveControls, endLive, showHostPip, flipCamera,
  } = useLiveBroadcast();

  const onLiveBroadcastScreen = useSyncExternalStore(
    (cb) => liveBroadcastNav.subscribeRoute(cb),
    () => liveBroadcastNav.isOnLiveBroadcast,
    () => false,
  );

  const blockFloatingTouches = useSyncExternalStore(
    (cb) => liveBroadcastNav.subscribeUiBlock(cb),
    () => liveBroadcastNav.blockFloatingTouches,
    () => false,
  );

  const visible = isLive && isMinimized && !onLiveBroadcastScreen;

  const barTotalW = winW - H_MARGIN * 2;
  const tabBarOffset = 60 + Math.max(0, insets.bottom);
  const bottomInset = tabBarOffset + 8;

  const defaultX = H_MARGIN;
  const defaultY = winH - BAR_HEIGHT - bottomInset;

  const pan = useRef(new Animated.ValueXY({ x: defaultX, y: defaultY })).current;
  const sizeRef = useRef({ barW: barTotalW, barH: BAR_HEIGHT });
  const movedRef = useRef(false);
  const [placed, setPlaced] = useState(false);

  const clampAndSet = useCallback((x: number, y: number) => {
    const { barW: w, barH: h } = sizeRef.current;
    const p = clampMiniBarPosition(
      x, y, w, h, winW, winH, insets.top, bottomInset,
    );
    pan.setValue(p);
  }, [pan, winW, winH, insets.top, bottomInset]);

  const onBarLayout = useCallback((e: { nativeEvent: { layout: { width: number; height: number } } }) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      sizeRef.current = { barW: width, barH: height };
    }
  }, []);

  React.useEffect(() => {
    if (!visible) {
      setPlaced(false);
      return;
    }
    if (!placed) {
      sizeRef.current = { barW: barTotalW, barH: BAR_HEIGHT };
      clampAndSet(defaultX, defaultY);
      setPlaced(true);
    }
  }, [visible, placed, defaultX, defaultY, barTotalW, clampAndSet]);

  React.useEffect(() => {
    if (!visible || !placed) return;
    // @ts-expect-error Animated internal value
    clampAndSet(pan.x._value ?? defaultX, pan.y._value ?? defaultY);
  }, [winW, winH, bottomInset, visible, placed, clampAndSet, defaultX, defaultY, pan]);

  const onReturn = useCallback(() => {
    // Open live controls first (chess flow), then resign game without leaving this stack.
    returnToLiveControls();
    liveBroadcastNav.returnToLive?.();
    InteractionManager.runAfterInteractions(() => {
      DeviceEventEmitter.emit(LIVE_BAR_RESIGN_GAME, { leaveGameScreen: false });
    });
  }, [returnToLiveControls]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        movedRef.current = false;
        pan.setOffset({
          // @ts-expect-error Animated internal value
          x: pan.x._value,
          // @ts-expect-error Animated internal value
          y: pan.y._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: (_, g) => {
        if (Math.abs(g.dx) > DRAG_THRESHOLD || Math.abs(g.dy) > DRAG_THRESHOLD) {
          movedRef.current = true;
        }
        Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false })(_, g);
      },
      onPanResponderRelease: () => {
        pan.flattenOffset();
        // @ts-expect-error Animated internal value
        clampAndSet(pan.x._value, pan.y._value);
        if (!movedRef.current) onReturn();
        movedRef.current = false;
      },
    }),
    [pan, clampAndSet, onReturn],
  );

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          width: barTotalW,
          transform: pan.getTranslateTransform(),
          zIndex: 9999,
          elevation: 12,
        },
      ]}
      pointerEvents={blockFloatingTouches ? 'none' : 'box-none'}
      onLayout={onBarLayout}
    >
      <View style={[styles.row, { width: barTotalW }]} pointerEvents="box-none">
        <View style={styles.main} {...panResponder.panHandlers}>
          <View style={styles.dot} />
          <View style={styles.mainBody}>
            <View style={styles.topRow}>
              <Text style={styles.title}>🔴 LIVE</Text>
              {isSharing ? <Text style={styles.chip}>🖥 sharing</Text> : null}
              {isSharing && !hostPipVisible ? (
                <TouchableOpacity onPress={showHostPip} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                  <Text style={styles.chip}>📷</Text>
                </TouchableOpacity>
              ) : null}
              {isSharing ? (
                <TouchableOpacity
                  onPress={() => { void flipCamera(); }}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Text style={styles.chip}>🔄</Text>
                </TouchableOpacity>
              ) : null}
              <Text style={styles.meta}>👁 {viewerCount}</Text>
            </View>
            <Text style={styles.tapHint} numberOfLines={1}>Drag · tap return</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.endBtn, { backgroundColor: colors.error, width: END_BTN_W }]}
          onPress={endLive}
          activeOpacity={0.9}
        >
          <Text style={styles.endText}>End</Text>
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: ROW_GAP,
  },
  main: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BAR_HEIGHT,
    backgroundColor: 'rgba(180, 30, 30, 0.96)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#fff',
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  mainBody: { flex: 1, minWidth: 0, justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 5 },
  title: { color: '#fff', fontWeight: '800', fontSize: 13, letterSpacing: 0.3 },
  chip: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  meta: { color: 'rgba(255,255,255,0.92)', fontSize: 12 },
  tapHint: { marginTop: 2, color: 'rgba(255,255,255,0.88)', fontSize: 11, fontWeight: '600' },
  endBtn: {
    minHeight: BAR_HEIGHT,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  endText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});

export default LiveStreamMiniBar;
