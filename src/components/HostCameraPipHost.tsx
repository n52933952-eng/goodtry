/**
 * Host camera pip while sharing: overlay (drag/resize/close) or restore chip when hidden.
 */

import React, { useSyncExternalStore } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { liveBroadcastNav } from '../services/liveBroadcastNav';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LocalTrack } from 'livekit-client';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import HostCameraPipOverlay from './HostCameraPipOverlay';

type Props = {
  track: LocalTrack;
  active?: boolean;
  zIndex?: number;
  topInsetExtra?: number;
};

const HostCameraPipHost = ({ track, active = true, zIndex, topInsetExtra = 0 }: Props) => {
  const insets = useSafeAreaInsets();
  const { hostPipVisible, showHostPip, hideHostPip, flipCamera } = useLiveBroadcast();
  const blockFloatingTouches = useSyncExternalStore(
    (cb) => liveBroadcastNav.subscribeUiBlock(cb),
    () => liveBroadcastNav.blockFloatingTouches,
    () => false,
  );

  if (!active || !track) return null;

  if (blockFloatingTouches) return null;

  if (!hostPipVisible) {
    const chipTop = Math.max(insets.top, 12) + 52 + topInsetExtra;
    return (
      <View style={[styles.chipColumn, { top: chipTop, right: 12 }]}>
        <TouchableOpacity
          style={styles.restoreChip}
          onPress={showHostPip}
          activeOpacity={0.85}
          accessibilityLabel="Show camera preview"
        >
          <Text style={styles.restoreIcon}>📷</Text>
          <Text style={styles.restoreText}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.restoreChip}
          onPress={() => { void flipCamera(); }}
          activeOpacity={0.85}
          accessibilityLabel="Flip camera"
        >
          <Text style={styles.restoreIcon}>🔄</Text>
          <Text style={styles.restoreText}>Flip</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <HostCameraPipOverlay
      track={track}
      visible
      onClose={hideHostPip}
      zIndex={zIndex}
      topInsetExtra={topInsetExtra}
    />
  );
};

const styles = StyleSheet.create({
  chipColumn: {
    position: 'absolute',
    alignItems: 'flex-end',
    gap: 8,
    zIndex: 9997,
    elevation: 10,
  },
  restoreChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.78)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  restoreIcon: { fontSize: 16 },
  restoreText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});

export default HostCameraPipHost;
