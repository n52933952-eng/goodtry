/**
 * Floating bar while a 1:1 or group call is active but the user left the call screen.
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, DeviceEventEmitter } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWebRTC } from '../context/LiveKitContext';
import { useGroupCall } from '../context/GroupCallContext';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import { useTheme } from '../context/ThemeContext';
import { LIVE_BAR_RESIGN_GAME } from '../utils/constants';
import { callSessionNav } from '../services/callSessionNav';

const BAR_HEIGHT = 52;

const CallSessionMiniBar = () => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const {
    callAccepted,
    isCallUIMinimized,
    isScreenSharing,
    openCallUI,
    refreshCallTracks,
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
  const { isLive, isMinimized: liveMinimized } = useLiveBroadcast();

  const isGroup = groupCallActive && isGroupCallUIMinimized;
  const isOneToOne = callAccepted && isCallUIMinimized && !groupCallActive;

  if (!isGroup && !isOneToOne) return null;

  const tabBarOffset = 60 + Math.max(0, insets.bottom);
  const stackOffset = isLive && liveMinimized ? BAR_HEIGHT + 10 : 0;
  const sharing = isGroup ? groupSharing : isScreenSharing;
  const title = isGroup ? 'Group call' : 'Call';
  const meta = isGroup
    ? `${participants.length + 1} people`
    : (call.name || 'In call');

  const onTapReturn = () => {
    if (sharing) return;
    if (isGroup) {
      openGroupCallUI();
      callSessionNav.returnToGroup?.();
    } else {
      openCallUI();
      callSessionNav.returnToOneToOne?.();
    }
  };

  const onOpenControls = async () => {
    if (isGroup) {
      openGroupCallUI();
      callSessionNav.returnToGroup?.();
    } else {
      await refreshCallTracks();
      await openCallUI();
      callSessionNav.returnToOneToOne?.();
    }
  };

  const onEnd = () => {
    DeviceEventEmitter.emit(LIVE_BAR_RESIGN_GAME);
    if (isGroup) leaveGroupCall();
    else leaveCall();
  };

  const cardBody = (
    <>
      <View style={styles.liveRing}>
        <View style={styles.liveDot} />
      </View>
      <View style={styles.textCol}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{title}</Text>
          {sharing ? (
            <View style={styles.sharePill}>
              <Text style={styles.sharePillText}>Sharing</Text>
            </View>
          ) : (
            <View style={styles.livePill}>
              <Text style={styles.livePillText}>Live</Text>
            </View>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <Text style={styles.hint}>
          {sharing ? 'Browse the app — your screen stays shared' : 'Tap to return to call'}
        </Text>
      </View>
      <View style={styles.actions}>
        {sharing ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.callBtn]}
            onPress={onOpenControls}
            activeOpacity={0.85}
            accessibilityLabel="Open call"
            accessibilityRole="button"
          >
            <Text style={styles.callBtnLabel}>Call</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[styles.actionBtn, styles.leaveBtn, { backgroundColor: colors.error }]}
          onPress={onEnd}
          activeOpacity={0.85}
        >
          <Text style={styles.leaveIcon}>✕</Text>
        </TouchableOpacity>
      </View>
    </>
  );

  return (
    <View style={[styles.wrap, { bottom: tabBarOffset + 8 + stackOffset }]} pointerEvents="box-none">
      <TouchableOpacity
        style={styles.card}
        onPress={sharing ? onOpenControls : onTapReturn}
        activeOpacity={0.92}
      >
        {cardBody}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9998,
    elevation: 12,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BAR_HEIGHT,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(18, 24, 38, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
  },
  liveRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  title: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
  livePill: {
    backgroundColor: 'rgba(76, 175, 80, 0.25)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  livePillText: {
    color: '#81C784',
    fontSize: 10,
    fontWeight: '700',
  },
  sharePill: {
    backgroundColor: 'rgba(33, 150, 243, 0.35)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
  },
  sharePillText: {
    color: '#90CAF9',
    fontSize: 10,
    fontWeight: '700',
  },
  meta: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 1,
  },
  hint: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(33, 150, 243, 0.45)',
    borderWidth: 1,
    borderColor: 'rgba(144, 202, 249, 0.5)',
  },
  callBtnLabel: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  leaveBtn: {
    backgroundColor: '#E53935',
  },
  leaveIcon: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
});

export default CallSessionMiniBar;
