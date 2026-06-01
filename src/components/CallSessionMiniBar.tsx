/**
 * Floating bar while a 1:1 or group call is active but the user left the call screen.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, DeviceEventEmitter } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWebRTC } from '../context/LiveKitContext';
import { useGroupCall } from '../context/GroupCallContext';
import { useTheme } from '../context/ThemeContext';
import { LIVE_BAR_RESIGN_GAME } from '../utils/constants';
import { callSessionNav } from '../services/callSessionNav';

const BAR_HEIGHT = 58;

const CallSessionMiniBar = () => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const {
    callAccepted,
    isCallUIMinimized,
    isScreenSharing,
    openCallUI,
    leaveCall,
    call,
  } = useWebRTC();
  const {
    groupCallActive,
    isGroupCallUIMinimized,
    isScreenSharing: groupSharing,
    openGroupCallUI,
    leaveGroupCall,
    participants,
  } = useGroupCall();
  const isGroup = groupCallActive && isGroupCallUIMinimized;
  const isOneToOne = callAccepted && isCallUIMinimized && !groupCallActive;

  if (!isGroup && !isOneToOne) return null;

  const tabBarOffset = 60 + Math.max(0, insets.bottom);
  const sharing = isGroup ? groupSharing : isScreenSharing;
  const title = isGroup ? 'GROUP CALL' : 'CALL';
  const meta = isGroup
    ? `${participants.length + 1} in call`
    : (call.name || 'In call');

  const onTapReturn = () => {
    if (isGroup) {
      openGroupCallUI();
      callSessionNav.returnToGroup?.();
    } else {
      openCallUI();
      callSessionNav.returnToOneToOne?.();
    }
  };

  const onEnd = () => {
    DeviceEventEmitter.emit(LIVE_BAR_RESIGN_GAME);
    if (isGroup) leaveGroupCall();
    else leaveCall();
  };

  return (
    <View style={[styles.wrap, { bottom: tabBarOffset + 8 }]} pointerEvents="box-none">
      <TouchableOpacity style={styles.main} onPress={onTapReturn} activeOpacity={0.9}>
        <View style={styles.dot} />
        <View style={styles.mainBody}>
          <View style={styles.topRow}>
            <Text style={styles.title}>{title}</Text>
            {sharing ? <Text style={styles.chip}>🖥 sharing</Text> : null}
            <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
          </View>
          <Text style={styles.tapHint}>Tap to return →</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.endBtn, { backgroundColor: colors.error }]}
        onPress={onEnd}
        activeOpacity={0.9}
      >
        <Text style={styles.endText}>Leave</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    zIndex: 9998,
    elevation: 11,
  },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BAR_HEIGHT,
    backgroundColor: 'rgba(0, 90, 180, 0.96)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#7CFC00',
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  mainBody: {
    flex: 1,
    justifyContent: 'center',
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  title: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  chip: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  meta: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    flexShrink: 1,
  },
  tapHint: {
    marginTop: 3,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 12,
    fontWeight: '600',
  },
  endBtn: {
    minHeight: BAR_HEIGHT,
    minWidth: 72,
    paddingHorizontal: 16,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 14,
  },
});

export default CallSessionMiniBar;
