/**
 * LiveBroadcastScreen — start and manage a mobile live stream (camera + chat).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Animated,
  FlatList, useWindowDimensions, ActivityIndicator,
  NativeModules, BackHandler, AppState,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { RoomEvent } from 'livekit-client';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { useLiveBroadcast } from '../../context/LiveBroadcastContext';
import HostCameraPipHost from '../../components/HostCameraPipHost';

const getDeviceLanguage = (): string => {
  try {
    let locale = '';
    if (Platform.OS === 'ios') {
      const s = NativeModules.SettingsManager?.settings;
      locale = s?.AppleLocale || s?.AppleLanguages?.[0] || '';
    } else {
      locale = NativeModules.I18nManager?.localeIdentifier || '';
    }
    return String(locale).toLowerCase();
  } catch {
    return '';
  }
};

const isArabicPhone = () => getDeviceLanguage().startsWith('ar');

/** Chat bar height — full pill radius */
const PILL_H = 46;
const CHAT_LOG_H = 180;
/** Floating chat stack: anchored above input, grows upward this far. */
const FLOAT_CHAT_STACK_H = 200;
const FLOAT_CHAT_MAX_H = 400;
/** How far each bubble drifts up before fading (px). */
const FLOAT_DRIFT_UP = 220;
const FLOAT_DRIFT_MS = 5500;
const FLOAT_FADE_DELAY_MS = 4200;
const FLOAT_FADE_MS = 1600;
const FLOAT_MSG_VISIBLE = 8;
const ACTION_CIRCLE = 50;
/** Vertical action rail — always 5 slots so icons never shift when Stop appears. */
const ACTION_SLOT_H = 82;
const ACTION_RAIL_SLOTS = 5;

const LiveActionButton = ({
  icon,
  label,
  onPress,
  circleStyle,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  circleStyle?: object;
}) => (
  <TouchableOpacity style={styles.actionItem} onPress={onPress} activeOpacity={0.85}>
    <View style={[styles.actionCircle, circleStyle]}>
      <Text style={styles.actionIcon}>{icon}</Text>
    </View>
    <Text style={styles.actionLabel}>{label}</Text>
  </TouchableOpacity>
);

interface FloatMsg {
  id: string; sender: string; text: string;
  anim: Animated.Value; opacity: Animated.Value;
}

const FloatingBubble = ({ msg }: { msg: FloatMsg }) => (
  <Animated.View
    style={[styles.floatBubble, { transform: [{ translateY: msg.anim }], opacity: msg.opacity }]}
    pointerEvents="none"
  >
    <Text style={styles.floatSender}>{msg.sender}: </Text>
    <Text style={styles.floatText}>{msg.text}</Text>
  </Animated.View>
);

const LiveBroadcastScreen = () => {
  const navigation = useNavigation<any>();
  const isScreenFocused = useIsFocused();
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();

  const bottomPad = Math.max(insets.bottom, 10);

  const {
    isLive, viewerCount, startingLive, localTrack, localScreenTrack, isSharing,
    isLiveControlsFocused,
    goLive, endLive: endLiveCtx, stopScreenShareOnly, shareAndGoAppHome, shareAndGoPhoneHome,
    setLiveControlsFocused, syncLocalTrack, getRoom, sendChat, flipCamera,
  } = useLiveBroadcast();

  /** Vertical action rail on the right — above chat bar */
  const actionRailBottom = bottomPad + PILL_H + 150;
  /** Chat bubbles + log sit directly above the “Say something…” bar */
  const INPUT_ROW_PAD_TOP = 10;
  const chatAboveInputBottom = bottomPad + PILL_H + INPUT_ROW_PAD_TOP + 8;

  /** Decoding full-screen preview while browsing feed doubles GPU/CPU load — only preview on live screen. */
  const showVideoPreview = isLiveControlsFocused;

  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<{ id: string; sender: string; text: string }[]>([]);
  const [floatMsgs, setFloatMsgs] = useState<FloatMsg[]>([]);
  const [showLog, setShowLog] = useState(false);

  const floatCoreH = Math.min(FLOAT_CHAT_MAX_H, Math.round(winH * 0.45));
  /** Bottom = just above send bar; height reaches same top as before (stack grows up). */
  const floatAreaBottom = chatAboveInputBottom + (showLog ? CHAT_LOG_H + 12 : 0);
  const floatAreaHeight = FLOAT_CHAT_STACK_H + floatCoreH;

  const flatRef = useRef<FlatList>(null);
  const ctr = useRef(0);
  const removeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const ar = isArabicPhone();

  const addMessage = useCallback((sender: string, text: string) => {
    const id = `msg_${++ctr.current}_${Date.now()}`;
    const anim = new Animated.Value(0);
    const opacity = new Animated.Value(1);
    setFloatMsgs(prev => [...prev.slice(-(FLOAT_MSG_VISIBLE - 1)), { id, sender, text, anim, opacity }]);
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);
    Animated.parallel([
      Animated.timing(anim, { toValue: -FLOAT_DRIFT_UP, duration: FLOAT_DRIFT_MS, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(FLOAT_FADE_DELAY_MS),
        Animated.timing(opacity, { toValue: 0, duration: FLOAT_FADE_MS, useNativeDriver: true }),
      ]),
    ]).start();
    const timer = setTimeout(() => {
      setFloatMsgs(prev => prev.filter(m => m.id !== id));
      removeTimersRef.current = removeTimersRef.current.filter(t => t !== timer);
    }, FLOAT_FADE_DELAY_MS + FLOAT_FADE_MS + 200);
    removeTimersRef.current.push(timer);
  }, []);

  const endLive = useCallback(async () => {
    await endLiveCtx();
  }, [endLiveCtx]);

  useFocusEffect(
    useCallback(() => {
      setLiveControlsFocused(true);
      syncLocalTrack();
      const room = getRoom();
      if (!room) return () => { setLiveControlsFocused(false); };
      const onData = (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat') addMessage(msg.sender, msg.text);
        } catch (_) {}
      };
      room.on(RoomEvent.DataReceived, onData);
      return () => {
        room.off(RoomEvent.DataReceived, onData);
        setLiveControlsFocused(false);
      };
    }, [syncLocalTrack, getRoom, addMessage, setLiveControlsFocused]),
  );

  /** After "Share phone" the app may resume on this screen while isMinimized stayed true. */
  useEffect(() => {
    if (!isScreenFocused || !isLive) return undefined;
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') setLiveControlsFocused(true);
    });
    return () => sub.remove();
  }, [isScreenFocused, isLive, setLiveControlsFocused]);

  useEffect(() => {
    if (!isLive) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (isSharing && isScreenFocused) {
        void stopScreenShareOnly();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [isLive, isSharing, isScreenFocused, stopScreenShareOnly]);

  useEffect(() => () => {
    removeTimersRef.current.forEach(clearTimeout);
    removeTimersRef.current = [];
  }, []);

  const sendChatMessage = useCallback(async () => {
    const text = chatInput.trim();
    if (!text) return;
    const sender = user?.name || user?.username || 'Streamer';
    await sendChat(text, sender);
    addMessage(sender, text);
    setChatInput('');
  }, [chatInput, user, sendChat, addMessage]);

  const placeholderContent = (() => {
    if (startingLive) {
      return { spinner: true, text: ar ? 'جاري بدء البث…' : 'Starting live…' };
    }
    if (!showVideoPreview && isLive && isSharing) {
      return {
        spinner: false,
        text: ar ? 'البث مستمر — شارك الشاشة من التطبيق' : 'Live — sharing app (tap bar to return)',
      };
    }
    if (isLive && showVideoPreview && isSharing && !localScreenTrack) {
      return { spinner: true, text: ar ? 'جاري تجهيز مشاركة الشاشة…' : 'Preparing screen share…' };
    }
    if (isLive && showVideoPreview && !localTrack && !localScreenTrack) {
      return { spinner: true, text: ar ? 'جاري تشغيل الكاميرا…' : 'Starting camera…' };
    }
    if (isLive) {
      return { spinner: true, text: ar ? 'جاري تجهيز البث…' : 'Preparing stream…' };
    }
    return { spinner: false, text: ar ? 'ستظهر المعاينة هنا' : 'Preview will appear here' };
  })();

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {showVideoPreview && localScreenTrack ? (
          <View style={[styles.videoRoot, styles.sharePreview, { width: winW, height: winH }]}>
            <Text style={styles.sharePreviewTitle}>
              {ar ? '🖥 تشارك الشاشة' : '🖥 Sharing screen'}
            </Text>
            <Text style={styles.sharePreviewSub}>
              {ar ? 'المشاهدون يرون تطبيقك — استخدم الشريط للعودة' : 'Viewers see your app — use the bar to return'}
            </Text>
          </View>
        ) : showVideoPreview && localTrack ? (
          <View style={[styles.videoRoot, { width: winW, height: winH }]} pointerEvents="none">
            <VideoView
              videoTrack={localTrack}
              style={{ width: winW, height: winH }}
              objectFit="cover"
              mirror
              zOrder={0}
            />
          </View>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            {placeholderContent.spinner ? (
              <ActivityIndicator size="large" color={colors.primary} style={{ marginBottom: 14 }} />
            ) : null}
            <Text style={styles.placeholderText}>{placeholderContent.text}</Text>
          </View>
        )}

        {isSharing && localTrack ? (
          <HostCameraPipHost track={localTrack} active topInsetExtra={44} />
        ) : null}

        <View style={styles.topBar}>
          <Text style={styles.topName}>{user?.name || user?.username}</Text>
          {isLive && (
            <>
              <View style={styles.livePill}><Text style={styles.livePillText}>🔴 LIVE</Text></View>
              <View style={[styles.viewerPill, { backgroundColor: 'rgba(0,0,0,0.5)' }]}>
                <Text style={{ color: '#fff', fontSize: 12 }}>👁 {viewerCount}</Text>
              </View>
            </>
          )}
          <TouchableOpacity
            style={[styles.endBtn, { backgroundColor: colors.error }]}
            onPress={isLive ? endLive : () => navigation.goBack()}
          >
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>
              {isLive ? (ar ? 'إنهاء' : 'End') : (ar ? 'إغلاق' : 'Close')}
            </Text>
          </TouchableOpacity>
        </View>

        {!isLive && (
          <View style={styles.goLiveWrap}>
            <TouchableOpacity
              style={[styles.goLiveBtn, { opacity: startingLive ? 0.85 : 1 }]}
              onPress={goLive}
              disabled={startingLive}
            >
              {startingLive ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.goLiveBtnText}>🔴  {ar ? 'بدء البث' : 'Go Live'}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <View
          style={[styles.floatArea, { bottom: floatAreaBottom, height: floatAreaHeight }]}
          pointerEvents="none"
        >
          {floatMsgs.map(m => <FloatingBubble key={m.id} msg={m} />)}
        </View>

        {showLog && (
          <View style={[styles.logPanel, { bottom: chatAboveInputBottom, backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <FlatList
              ref={flatRef}
              data={chatLog}
              keyExtractor={item => item.id}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <Text style={{ color: '#fff', fontSize: 13, marginBottom: 4 }}>
                  <Text style={{ color: '#FFD700', fontWeight: 'bold' }}>{item.sender}: </Text>
                  {item.text}
                </Text>
              )}
            />
          </View>
        )}

        {isLive && (
          <View style={[styles.actionRail, { bottom: actionRailBottom }, isSharing && styles.actionRailSharing]}>
            <View style={[styles.actionSlot, { bottom: ACTION_SLOT_H * 4 }]}>
              {!isSharing ? (
                <LiveActionButton
                  icon="🏠"
                  label={ar ? 'مشاركة' : 'Share app'}
                  onPress={shareAndGoAppHome}
                  circleStyle={{ backgroundColor: colors.primary, borderColor: 'transparent' }}
                />
              ) : (
                <View style={styles.actionSlotReserved} pointerEvents="none" />
              )}
            </View>
            <View style={[styles.actionSlot, { bottom: ACTION_SLOT_H * 3 }]}>
              {!isSharing ? (
                <LiveActionButton
                  icon="📱"
                  label={ar ? 'الهاتف' : 'Share phone'}
                  onPress={shareAndGoPhoneHome}
                />
              ) : (
                <View style={styles.actionSlotReserved} pointerEvents="none" />
              )}
            </View>
            <View style={[styles.actionSlot, { bottom: ACTION_SLOT_H * 2 }]}>
              <LiveActionButton
                icon="💬"
                label={ar ? 'دردشة' : 'Chat'}
                onPress={() => setShowLog(v => !v)}
              />
            </View>
            <View style={[styles.actionSlot, { bottom: ACTION_SLOT_H }]}>
              {(localTrack || isSharing) ? (
                <LiveActionButton
                  icon="🔄"
                  label={ar ? 'قلب' : 'Flip'}
                  onPress={() => { void flipCamera(); }}
                />
              ) : (
                <View style={styles.actionSlotReserved} pointerEvents="none" />
              )}
            </View>
            <View style={[styles.actionSlot, { bottom: 0 }]}>
              {isSharing ? (
                <LiveActionButton
                  icon="🛑"
                  label={ar ? 'إيقاف' : 'Stop'}
                  onPress={() => { void stopScreenShareOnly(); }}
                  circleStyle={{ borderColor: colors.error, borderWidth: 2 }}
                />
              ) : (
                <View style={styles.actionSlotReserved} pointerEvents="none" />
              )}
            </View>
          </View>
        )}

        {isLive && (
          <View style={[styles.inputRow, { paddingBottom: bottomPad }]}>
            <TextInput
              style={[styles.textInput, { color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }]}
              placeholder={ar ? 'اكتب شيئاً…' : 'Say something…'}
              placeholderTextColor="#888"
              value={chatInput}
              onChangeText={setChatInput}
              onSubmitEditing={sendChatMessage}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.primary }]}
              onPress={sendChatMessage}
              activeOpacity={0.85}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>{ar ? 'إرسال' : 'Send'}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  videoRoot:        {
    position: 'absolute', top: 0, left: 0, overflow: 'hidden',
    backgroundColor: '#000', alignItems: 'center', justifyContent: 'center',
  },
  sharePreview:     { paddingHorizontal: 28 },
  sharePreviewTitle:{ color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  sharePreviewSub:  { color: '#aaa', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  placeholder:      { justifyContent: 'center', alignItems: 'center', backgroundColor: '#111', paddingHorizontal: 28 },
  placeholderText:  { color: '#aaa', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  actionRail: {
    position: 'absolute',
    right: 10,
    width: 76,
    height: ACTION_SLOT_H * ACTION_RAIL_SLOTS,
    zIndex: 25,
  },
  actionRailSharing: {
    zIndex: 10002,
    elevation: 10002,
  },
  actionSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: ACTION_SLOT_H,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  actionSlotReserved: {
    width: ACTION_CIRCLE,
    height: ACTION_CIRCLE + 18,
  },
  actionItem: { alignItems: 'center' },
  actionCircle: {
    width: ACTION_CIRCLE,
    height: ACTION_CIRCLE,
    borderRadius: 9999,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  actionIcon: { fontSize: 22 },
  actionLabel: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 5,
    textAlign: 'center',
    maxWidth: 72,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  topBar:           {
    position: 'absolute', top: 44, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topName:          { color: '#fff', fontWeight: 'bold', fontSize: 14, flex: 1 },
  livePill:         { backgroundColor: 'red', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  livePillText:     { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  viewerPill:       { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  endBtn:           { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 16 },
  goLiveWrap:       { position: 'absolute', bottom: 100, left: 0, right: 0, alignItems: 'center' },
  goLiveBtn:        { backgroundColor: '#E53E3E', borderRadius: 30, paddingHorizontal: 32, paddingVertical: 14 },
  goLiveBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  floatArea: {
    position: 'absolute',
    left: 12,
    right: 88,
    justifyContent: 'flex-end',
  },
  floatBubble:      {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, alignSelf: 'flex-start',
  },
  floatSender:      { color: '#FFD700', fontWeight: 'bold', fontSize: 13 },
  floatText:        { color: '#fff', fontSize: 13 },
  logPanel:         {
    position: 'absolute', right: 88, left: 12,
    height: CHAT_LOG_H, borderRadius: 16, padding: 10,
  },
  inputRow:         {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  textInput:        {
    flex: 1,
    height: PILL_H,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 16,
    paddingVertical: 0,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn:          {
    height: PILL_H,
    minWidth: PILL_H,
    paddingHorizontal: 18,
    borderRadius: 9999,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default LiveBroadcastScreen;
