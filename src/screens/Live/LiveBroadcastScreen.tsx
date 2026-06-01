/**
 * LiveBroadcastScreen — start and manage a mobile live stream (camera + chat).
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Image, Animated,
  FlatList, useWindowDimensions, ActivityIndicator,
  NativeModules,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { RoomEvent } from 'livekit-client';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { useLiveBroadcast } from '../../context/LiveBroadcastContext';

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
  const { user } = useUser();
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const {
    isLive, viewerCount, startingLive, localTrack,
    goLive, endLive: endLiveCtx, syncLocalTrack, getRoom, sendChat,
  } = useLiveBroadcast();

  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<{ id: string; sender: string; text: string }[]>([]);
  const [floatMsgs, setFloatMsgs] = useState<FloatMsg[]>([]);
  const [showLog, setShowLog] = useState(false);

  const flatRef = useRef<FlatList>(null);
  const ctr = useRef(0);
  const removeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const ar = isArabicPhone();

  const addMessage = useCallback((sender: string, text: string) => {
    const id = `msg_${++ctr.current}_${Date.now()}`;
    const anim = new Animated.Value(0);
    const opacity = new Animated.Value(1);
    setFloatMsgs(prev => [...prev.slice(-6), { id, sender, text, anim, opacity }]);
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);
    Animated.parallel([
      Animated.timing(anim, { toValue: -120, duration: 4000, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(2500),
        Animated.timing(opacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ]),
    ]).start();
    const timer = setTimeout(() => {
      setFloatMsgs(prev => prev.filter(m => m.id !== id));
      removeTimersRef.current = removeTimersRef.current.filter(t => t !== timer);
    }, 4200);
    removeTimersRef.current.push(timer);
  }, []);

  const endLive = useCallback(async () => {
    await endLiveCtx();
    if (navigation.canGoBack()) navigation.goBack();
  }, [endLiveCtx, navigation]);

  useFocusEffect(
    useCallback(() => {
      syncLocalTrack();
      const room = getRoom();
      if (!room) return undefined;
      const onData = (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat') addMessage(msg.sender, msg.text);
        } catch (_) {}
      };
      room.on(RoomEvent.DataReceived, onData);
      return () => { room.off(RoomEvent.DataReceived, onData); };
    }, [syncLocalTrack, getRoom, addMessage]),
  );

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

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {localTrack ? (
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
            {user?.profilePic
              ? <Image source={{ uri: user.profilePic }} style={styles.placeholderAvatar} />
              : null}
            <Text style={{ color: '#888', marginTop: 12, textAlign: 'center' }}>
              {isLive ? (ar ? 'الكاميرا غير متاحة' : 'Camera not available') : (ar ? 'ستظهر المعاينة هنا' : 'Preview will appear here')}
            </Text>
          </View>
        )}

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

        <View style={styles.floatArea} pointerEvents="none">
          {floatMsgs.map(m => <FloatingBubble key={m.id} msg={m} />)}
        </View>

        <TouchableOpacity
          style={[styles.logToggle, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
          onPress={() => setShowLog(v => !v)}
        >
          <Text style={{ color: '#fff', fontSize: 18 }}>💬</Text>
        </TouchableOpacity>

        {showLog && (
          <View style={[styles.logPanel, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
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
          <View style={styles.inputRow}>
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
  placeholder:      { justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  placeholderAvatar:{ width: 90, height: 90, borderRadius: 45 },
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
  floatArea:        { position: 'absolute', bottom: 118, left: 12, right: 80 },
  floatBubble:      {
    flexDirection: 'row', flexWrap: 'wrap', backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, alignSelf: 'flex-start',
  },
  floatSender:      { color: '#FFD700', fontWeight: 'bold', fontSize: 13 },
  floatText:        { color: '#fff', fontSize: 13 },
  logToggle:        {
    position: 'absolute', bottom: 120, right: 12,
    width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center',
  },
  logPanel:         {
    position: 'absolute', bottom: 120, right: 60, left: 12,
    height: 180, borderRadius: 12, padding: 10,
  },
  inputRow:         {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8, paddingHorizontal: 12,
    paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.6)',
  },
  textInput:        {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn:          { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, justifyContent: 'center' },
});

export default LiveBroadcastScreen;
