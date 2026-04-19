/**
 * LiveViewerScreen — watch a live stream on mobile.
 *
 * Features:
 *  - Full-screen remote video
 *  - Floating animated chat messages (like Instagram Live)
 *  - Bottom chat input (ephemeral — no DB)
 *  - All messages visible to everyone in the room via LiveKit data channel
 */

import React, {
  useEffect, useRef, useState, useCallback,
} from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Image, Animated,
  FlatList, useWindowDimensions,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { Room, RoomEvent } from 'livekit-client';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import InCallManager from 'react-native-incall-manager';
import { API_URL } from '../../utils/constants';

// ── Floating message (animates up then fades) ─────────────────────────────────
interface FloatMsg { id: string; sender: string; text: string; anim: Animated.Value; opacity: Animated.Value }

const FloatingBubble = ({ msg }: { msg: FloatMsg }) => (
  <Animated.View
    style={[
      styles.floatBubble,
      {
        transform: [{ translateY: msg.anim }],
        opacity:   msg.opacity,
      },
    ]}
    pointerEvents="none"
  >
    <Text style={styles.floatSender}>{msg.sender}: </Text>
    <Text style={styles.floatText}>{msg.text}</Text>
  </Animated.View>
);

// ─────────────────────────────────────────────────────────────────────────────
const LiveViewerScreen = () => {
  const navigation = useNavigation<any>();
  const route      = useRoute<any>();
  const { user }   = useUser();
  const socketCtx  = useSocket();
  const socket     = socketCtx?.socket;
  const { colors } = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();

  const { streamerId, streamerName, streamerProfilePic } = route.params || {};

  const [remoteVideoTrack, setRemoteVideoTrack] = useState<any>(null);
  const [isConnected,      setIsConnected]      = useState(false);
  const [chatInput,        setChatInput]        = useState('');
  // permanent log (scrollable)
  const [chatLog,          setChatLog]          = useState<{ id: string; sender: string; text: string }[]>([]);
  // floating animations
  const [floatMsgs,        setFloatMsgs]        = useState<FloatMsg[]>([]);
  const [showLog,          setShowLog]          = useState(false);

  const roomRef    = useRef<Room | null>(null);
  const flatRef    = useRef<FlatList>(null);
  let msgCounter   = useRef(0);
  const removeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // ── add message ─────────────────────────────────────────────────────────
  const addMessage = useCallback((sender: string, text: string) => {
    const id  = `msg_${++msgCounter.current}_${Date.now()}`;
    const anim    = new Animated.Value(0);
    const opacity = new Animated.Value(1);

    const floatMsg: FloatMsg = { id, sender, text, anim, opacity };
    setFloatMsgs(prev => [...prev.slice(-6), floatMsg]);
    setChatLog(prev => [...prev.slice(-100), { id, sender, text }]);

    // Float up animation
    Animated.parallel([
      Animated.timing(anim, {
        toValue:         -120,
        duration:        4000,
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(2500),
        Animated.timing(opacity, {
          toValue:         0,
          duration:        1500,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      setFloatMsgs(prev => prev.filter(m => m.id !== id));
      removeTimersRef.current = removeTimersRef.current.filter(t => t !== timer);
    }, 4200);
    removeTimersRef.current.push(timer);
  }, []);

  // ── connect room ─────────────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    const join = async () => {
      try {
        const statusRes = await fetch(`${API_URL}/api/call/livestream/${encodeURIComponent(String(streamerId))}/status`, {
          credentials: 'include',
        });
        if (statusRes.ok && mounted) {
          const st = await statusRes.json().catch(() => ({}));
          if (st && st.active === false) {
            if (mounted) navigation.goBack();
            return;
          }
        }
        const res = await fetch(`${API_URL}/api/call/token`, {
          method:      'POST',
          headers:     { 'Content-Type': 'application/json' },
          credentials: 'include',
          body:        JSON.stringify({ type: 'viewer', targetId: streamerId }),
        });
        if (!res.ok || !mounted) return;
        const { token, livekitUrl } = await res.json();

        const lkRoom = new Room();
        roomRef.current = lkRoom;

        lkRoom.on(RoomEvent.TrackSubscribed, (track: any) => {
          if (track.kind === 'video' && mounted) setRemoteVideoTrack(track);
        });
        lkRoom.on(RoomEvent.TrackUnsubscribed, (track: any) => {
          if (track.kind === 'video') setRemoteVideoTrack(null);
        });
        lkRoom.on(RoomEvent.Disconnected, () => {
          if (mounted) navigation.goBack();
        });
        lkRoom.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload));
            if (msg.type === 'chat' && mounted) addMessage(msg.sender, msg.text);
          } catch (_) {}
        });

        await lkRoom.connect(livekitUrl, token);
        try {
          InCallManager.start({ media: 'video', auto: false, ringback: '' });
          InCallManager.setForceSpeakerphoneOn(true);
        } catch (_) {}
        if (mounted) setIsConnected(true);
      } catch (_) {
        if (mounted) navigation.goBack();
      }
    };
    join();
    return () => {
      mounted = false;
      removeTimersRef.current.forEach(clearTimeout);
      removeTimersRef.current = [];
      try { InCallManager.stop(); } catch (_) {}
      roomRef.current?.disconnect().catch(() => {});
    };
  }, [streamerId, navigation]);

  // ── stream ended (socket) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onEnded = (payload: any) => {
      const sid = payload?.streamerId != null ? String(payload.streamerId) : '';
      if (sid && sid === String(streamerId)) {
        roomRef.current?.disconnect().catch(() => {});
        navigation.goBack();
      }
    };
    socket.on('livekit:streamEnded', onEnded);
    return () => socket.off('livekit:streamEnded', onEnded);
  }, [socket, streamerId, navigation]);

  // ── send chat ─────────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !roomRef.current) return;
    const msg = { type: 'chat', sender: user?.name || user?.username || 'Viewer', text };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await roomRef.current.localParticipant.publishData(encoded, { reliable: true });
    addMessage(msg.sender, msg.text);
    setChatInput('');
  }, [chatInput, user, addMessage]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        {/* Full-screen video */}
        {remoteVideoTrack ? (
          <View style={[styles.videoRoot, { width: winW, height: winH }]} pointerEvents="none">
            <VideoView
              videoTrack={remoteVideoTrack}
              style={{ width: winW, height: winH }}
              objectFit="cover"
              zOrder={0}
            />
          </View>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            {streamerProfilePic
              ? <Image source={{ uri: streamerProfilePic }} style={styles.placeholderAvatar} />
              : <View style={[styles.placeholderAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={{ color: colors.textGray, fontSize: 36, fontWeight: 'bold' }}>
                    {(streamerName || '?').charAt(0).toUpperCase()}
                  </Text>
                </View>
            }
            <Text style={{ color: '#888', marginTop: 12 }}>
              {isConnected ? 'Waiting for video…' : 'Connecting…'}
            </Text>
          </View>
        )}

        {/* Top bar */}
        <View style={styles.topBar}>
          {streamerProfilePic
            ? <Image source={{ uri: streamerProfilePic }} style={styles.topAvatar} />
            : null}
          <Text style={styles.topName}>{streamerName}</Text>
          <View style={styles.livePill}><Text style={styles.livePillText}>🔴 LIVE</Text></View>
          <TouchableOpacity style={[styles.topBtn, { backgroundColor: colors.error }]} onPress={() => navigation.goBack()}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>Leave</Text>
          </TouchableOpacity>
        </View>

        {/* Floating messages */}
        <View style={styles.floatArea} pointerEvents="none">
          {floatMsgs.map(m => <FloatingBubble key={m.id} msg={m} />)}
        </View>

        {/* Chat log toggle button */}
        <TouchableOpacity
          style={[styles.logToggle, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
          onPress={() => setShowLog(v => !v)}
        >
          <Text style={{ color: '#fff', fontSize: 18 }}>💬</Text>
        </TouchableOpacity>

        {/* Chat log panel */}
        {showLog && (
          <View style={[styles.logPanel, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <FlatList
              ref={flatRef}
              data={chatLog}
              keyExtractor={item => item.id}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <View style={{ marginBottom: 4 }}>
                  <Text style={{ color: '#fff', fontSize: 13 }}>
                    <Text style={{ color: '#FFD700', fontWeight: 'bold' }}>{item.sender}: </Text>
                    {item.text}
                  </Text>
                </View>
              )}
            />
          </View>
        )}

        {/* Chat input */}
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
  placeholderAvatar:{ width: 100, height: 100, borderRadius: 50 },
  avatarPlaceholder:{ justifyContent: 'center', alignItems: 'center' },
  topBar:           {
    position: 'absolute', top: 44, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  topAvatar:        { width: 32, height: 32, borderRadius: 16 },
  topName:          { color: '#fff', fontWeight: 'bold', fontSize: 14, flex: 1 },
  livePill:         { backgroundColor: 'red', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  livePillText:     { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  topBtn:           { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 16 },
  floatArea:        {
    position: 'absolute', bottom: 80, left: 12, right: 12,
  },
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

export default LiveViewerScreen;
