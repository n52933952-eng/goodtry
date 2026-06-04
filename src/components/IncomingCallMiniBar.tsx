/**
 * Incoming 1:1 call while hosting live — mini bar (Answer / Decline) instead of full CallScreen.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useWebRTC } from '../context/LiveKitContext';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import { useTheme } from '../context/ThemeContext';
import { callSessionNav } from '../services/callSessionNav';

const BAR_HEIGHT = 64;
const LIVE_BAR_STACK = 66;
const ACTION_SIZE = 48;

const IncomingCallMiniBar = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { isLive, isMinimized, endLiveForCall } = useLiveBroadcast();
  const {
    call,
    callEnded,
    callAccepted,
    answerCall,
    leaveCall,
    getIncomingCallFromNotificationCallerId,
  } = useWebRTC();

  const [answering, setAnswering] = useState(false);
  const autoAnswerStartedRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const visible = !!(
    isLive
    && call.isReceivingCall
    && call.from
    && !callAccepted
    && !callEnded
  );

  useEffect(() => {
    if (!visible) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);

  const ringScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.14],
  });
  const ringOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 1],
  });

  const tabBarOffset = 60 + Math.max(0, insets.bottom) + 8;
  const bottom = tabBarOffset + (isMinimized ? LIVE_BAR_STACK : 0);

  const openCallScreen = useCallback(() => {
    navigation.navigate('CallScreen', {
      userName: call.name,
      userId: call.from,
      callType: call.callType || 'video',
      isFromNotification: false,
      incomingCallKey: Date.now(),
    });
    callSessionNav.returnToOneToOne?.();
  }, [navigation, call.from, call.name, call.callType]);

  const handleAnswer = useCallback(async () => {
    if (answering) return;
    setAnswering(true);
    try {
      await endLiveForCall();
      await answerCall();
      openCallScreen();
    } catch (e) {
      console.warn('[IncomingCallMiniBar] answer failed:', e);
    } finally {
      setAnswering(false);
    }
  }, [answering, endLiveForCall, answerCall, openCallScreen]);

  const handleDecline = useCallback(() => {
    leaveCall();
  }, [leaveCall]);

  useEffect(() => {
    if (!visible) {
      autoAnswerStartedRef.current = false;
      return;
    }
    const notifCaller = getIncomingCallFromNotificationCallerId?.() ?? null;
    if (!notifCaller || notifCaller !== call.from) return;
    if (autoAnswerStartedRef.current) return;
    autoAnswerStartedRef.current = true;
    void handleAnswer();
  }, [visible, call.from, getIncomingCallFromNotificationCallerId, handleAnswer]);

  if (!visible) return null;

  const isVideo = call.callType === 'video';
  const callerName = call.name || 'Unknown';
  const initial = callerName.charAt(0).toUpperCase();

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.avatarWrap}>
            <Animated.View
              style={[
                styles.pulseRing,
                { borderColor: colors.primary, opacity: ringOpacity, transform: [{ scale: ringScale }] },
              ]}
            />
            {call.profilePic ? (
              <Image source={{ uri: call.profilePic }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarPlaceholder]}>
                <Text style={styles.avatarLetter}>{initial}</Text>
              </View>
            )}
          </View>

          <View style={styles.body}>
            <View style={styles.labelRow}>
              <View style={styles.incomingPill}>
                <View style={styles.incomingDot} />
                <Text style={styles.incomingPillText}>INCOMING</Text>
              </View>
              <View style={styles.typeChip}>
                <Text style={styles.typeChipText}>{isVideo ? '📹 Video' : '🎙 Voice'}</Text>
              </View>
            </View>
            <Text style={styles.name} numberOfLines={1}>{callerName}</Text>
            <Text style={styles.hint} numberOfLines={1}>Answer ends your live stream</Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.actionBtn, styles.declineBtn]}
              onPress={handleDecline}
              disabled={answering}
              activeOpacity={0.82}
              accessibilityLabel="Decline call"
            >
              <Text style={styles.actionIcon}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionBtn, styles.answerBtn, { backgroundColor: colors.success }]}
              onPress={() => { void handleAnswer(); }}
              disabled={answering}
              activeOpacity={0.82}
              accessibilityLabel="Answer call"
            >
              {answering ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.actionIcon}>📞</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 10000,
    elevation: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
  },
  card: {
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    backgroundColor: 'rgba(18, 55, 120, 0.97)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: BAR_HEIGHT,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 10,
    gap: 10,
  },
  avatarWrap: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2.5,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  avatarPlaceholder: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 18,
  },
  body: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 3,
  },
  incomingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.16)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  incomingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#7CFC00',
  },
  incomingPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  typeChip: {
    backgroundColor: 'rgba(0,0,0,0.22)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  typeChipText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontWeight: '600',
  },
  name: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.2,
  },
  hint: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  actionBtn: {
    width: ACTION_SIZE,
    height: ACTION_SIZE,
    borderRadius: ACTION_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  declineBtn: {
    backgroundColor: 'rgba(220, 38, 38, 0.95)',
  },
  answerBtn: {
    shadowColor: '#00BA7C',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.45,
    shadowRadius: 6,
    elevation: 4,
  },
  actionIcon: {
    fontSize: 22,
    color: '#fff',
  },
});

export default IncomingCallMiniBar;
