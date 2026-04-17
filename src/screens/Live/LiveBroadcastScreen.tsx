/**
 * LiveBroadcastScreen — start and manage a mobile live stream.
 *
 * Features:
 *  - Camera preview
 *  - Go Live / End buttons
 *  - Viewer count
 *  - Floating animated incoming chat messages
 *  - Chat input (messages broadcast via LiveKit data channel)
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Image, Animated,
  FlatList, useWindowDimensions, Alert, ActivityIndicator,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useNavigation } from '@react-navigation/native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import InCallManager from 'react-native-incall-manager';
import { API_URL } from '../../utils/constants';

/** Matches backend `getLiveKitToken`: livestream JWT TTL is 25m — end UI cleanly before expiry. */
const LIVESTREAM_MAX_MS = 25 * 60 * 1000;
const LIVESTREAM_AUTO_END_BEFORE_MS = 90 * 1000;

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
  const { user }   = useUser();
  const socketCtx  = useSocket();
  const socket     = socketCtx?.socket;
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const [isLive,        setIsLive]       = useState(false);
  const [localTrack,    setLocalTrack]   = useState<any>(null);
  const [viewerCount,   setViewerCount]  = useState(0);
  const [chatInput,     setChatInput]    = useState('');
  const [chatLog,       setChatLog]      = useState<{ id: string; sender: string; text: string }[]>([]);
  const [floatMsgs,     setFloatMsgs]    = useState<FloatMsg[]>([]);
  const [showLog,       setShowLog]      = useState(false);
  const [startingLive,  setStartingLive] = useState(false);

  const roomRef    = useRef<Room | null>(null);
  const roomNameRef = useRef('');
  const flatRef    = useRef<FlatList>(null);
  const ctr        = useRef(0);
  const removeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const endLiveRef = useRef<() => Promise<void>>(async () => {});

  const addMessage = useCallback((sender: string, text: string) => {
    const id      = `msg_${++ctr.current}_${Date.now()}`;
    const anim    = new Animated.Value(0);
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

  const disconnect = useCallback(async () => {
    try { InCallManager.stop(); } catch (_) {}
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null;
    setLocalTrack(null);
  }, []);

  const goLive = useCallback(async () => {
    if (!user || !socket || startingLive) return;
    setStartingLive(true);
    try {
      const res = await fetch(`${API_URL}/api/call/token`, {
        method:      'POST',
        headers:     { 'Content-Type': 'application/json' },
        credentials: 'include',
        body:        JSON.stringify({ type: 'livestream', targetId: String(user._id) }),
      });
      if (!res.ok) return;
      const { token, roomName, livekitUrl } = await res.json();
      roomNameRef.current = roomName;

      const lkRoom = new Room();
      roomRef.current = lkRoom;

      lkRoom.on(RoomEvent.ParticipantConnected,    () => setViewerCount(c => c + 1));
      lkRoom.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));
      lkRoom.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (msg.type === 'chat') addMessage(msg.sender, msg.text);
        } catch (_) {}
      });
      lkRoom.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        setLocalTrack(null);
        setIsLive(false);
        if (navigation.canGoBack()) navigation.goBack();
      });

      await lkRoom.connect(livekitUrl, token);

      // Route live audio to loudspeaker (watching-a-live feel); mic before camera for faster readiness.
      try {
        InCallManager.start({ media: 'video', auto: false, ringback: '' });
        InCallManager.setForceSpeakerphoneOn(true);
      } catch (_) {}

      await lkRoom.localParticipant.setMicrophoneEnabled(true);
      await lkRoom.localParticipant.setCameraEnabled(true);

      const camPub = lkRoom.localParticipant.getTrackPublication(Track.Source.Camera);
      if (camPub?.track) setLocalTrack(camPub.track);

      setIsLive(true);
      socket.emit('livekit:goLive', {
        streamerId:         String(user._id),
        streamerName:       user.name || user.username,
        streamerProfilePic: user.profilePic,
        roomName,
      });
    } catch (err) {
      console.error('[LiveBroadcast] goLive:', err);
    } finally {
      setStartingLive(false);
    }
  }, [user, socket, addMessage, navigation, startingLive]);

  const endLive = useCallback(async () => {
    if (socket && user?._id) {
      socket.emit('livekit:endLive', { streamerId: String(user._id), roomName: roomNameRef.current });
    }
    await disconnect();
    setIsLive(false);
    navigation.goBack();
  }, [socket, user, disconnect, navigation]);

  endLiveRef.current = endLive;

  useEffect(() => {
    if (!isLive) return;
    const ms = Math.max(60_000, LIVESTREAM_MAX_MS - LIVESTREAM_AUTO_END_BEFORE_MS);
    const t = setTimeout(() => {
      Alert.alert(
        'Live session limit',
        'Your broadcast reached the maximum session length (about 25 minutes). The stream is ending so you can start a new one.',
      );
      void endLiveRef.current?.();
    }, ms);
    return () => clearTimeout(t);
  }, [isLive]);

  useEffect(() => {
    if (!socket || !isLive || !user?._id) return;
    const onStreamEnded = async (payload: any) => {
      if (String(payload?.streamerId || '') !== String(user._id)) return;
      await disconnect();
      setIsLive(false);
      if (payload?.reason === 'timeout') {
        Alert.alert(
          'Live session limit',
          'Your broadcast reached the maximum session length (25 minutes).',
        );
      }
      if (navigation.canGoBack()) navigation.goBack();
    };
    socket.on('livekit:streamEnded', onStreamEnded);
    return () => {
      socket.off('livekit:streamEnded', onStreamEnded);
    };
  }, [socket, isLive, user?._id, disconnect, navigation]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !roomRef.current) return;
    const msg = { type: 'chat', sender: user?.name || user?.username || 'Streamer', text };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await roomRef.current.localParticipant.publishData(encoded, { reliable: true });
    addMessage(msg.sender, msg.text);
    setChatInput('');
  }, [chatInput, user, addMessage]);

  useEffect(() => () => {
    removeTimersRef.current.forEach(clearTimeout);
    removeTimersRef.current = [];
    disconnect();
  }, [disconnect]);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.container}>
        {/* Camera: explicit size + overflow fixes Android RTCView not filling width */}
        {localTrack ? (
          <View
            style={[
              styles.videoRoot,
              { width: winW, height: winH },
            ]}
            pointerEvents="none"
          >
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
              {isLive ? 'Camera not available' : 'Preview will appear here'}
            </Text>
          </View>
        )}

        {/* Top bar */}
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
              {isLive ? 'End' : 'Close'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Go Live button (before starting) */}
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
                <Text style={styles.goLiveBtnText}>🔴  Go Live</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Floating messages */}
        <View style={styles.floatArea} pointerEvents="none">
          {floatMsgs.map(m => <FloatingBubble key={m.id} msg={m} />)}
        </View>

        {/* Chat log toggle */}
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

        {/* Chat input */}
        {isLive && (
          <View style={styles.inputRow}>
            <TextInput
              style={[styles.textInput, { color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }]}
              placeholder="Say something…"
              placeholderTextColor="#888"
              value={chatInput}
              onChangeText={setChatInput}
              onSubmitEditing={sendChat}
              returnKeyType="send"
            />
            <TouchableOpacity
              style={[styles.sendBtn, { backgroundColor: colors.primary }]}
              onPress={sendChat}
            >
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>Send</Text>
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
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
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
  goLiveWrap:       {
    position: 'absolute',
    bottom: 100,
    left: 0, right: 0,
    alignItems: 'center',
  },
  goLiveBtn:        {
    backgroundColor: '#E53E3E', borderRadius: 30,
    paddingHorizontal: 32, paddingVertical: 14,
  },
  goLiveBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  floatArea:        { position: 'absolute', bottom: 80, left: 12, right: 80 },
  floatBubble:      {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, alignSelf: 'flex-start',
  },
  floatSender:      { color: '#FFD700', fontWeight: 'bold', fontSize: 13 },
  floatText:        { color: '#fff', fontSize: 13 },
  logToggle:        {
    position: 'absolute', bottom: 72, right: 12,
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
  },
  logPanel:         {
    position: 'absolute', bottom: 72, right: 60, left: 12,
    height: 180, borderRadius: 12, padding: 10,
  },
  inputRow:         {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8, paddingHorizontal: 12,
    paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.6)',
  },
  textInput:        {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn:          { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, justifyContent: 'center' },
});

export default LiveBroadcastScreen;
