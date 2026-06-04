/**
 * LiveViewerScreen — watch a live stream on mobile.
 */

import React, {
  useEffect, useRef, useState, useCallback,
} from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  KeyboardAvoidingView, Platform, Image, Animated,
  FlatList,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { Room, RoomEvent } from 'livekit-client';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import InCallManager from 'react-native-incall-manager';
import { API_URL } from '../../utils/constants';
import ScreenShareViewer from '../../components/ScreenShareViewer';
import {
  isScreenSharePublication,
  isVideoPublication,
  collectRemoteVideoTracks,
} from '../../utils/liveKitTracks';

interface FloatMsg { id: string; sender: string; text: string; anim: Animated.Value; opacity: Animated.Value }

const FloatingBubble = ({ msg }: { msg: FloatMsg }) => (
  <Animated.View
    style={[
      styles.floatBubble,
      {
        transform: [{ translateY: msg.anim }],
        opacity: msg.opacity,
      },
    ]}
    pointerEvents="none"
  >
    <Text style={styles.floatSender}>{msg.sender}: </Text>
    <Text style={styles.floatText}>{msg.text}</Text>
  </Animated.View>
);

const LiveViewerScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useUser();
  const socketCtx = useSocket();
  const socket = socketCtx?.socket;
  const { colors } = useTheme();

  const { streamerId, streamerName, streamerProfilePic } = route.params || {};

  const [remoteScreenTrack, setRemoteScreenTrack] = useState<any>(null);
  const [remoteCameraTrack, setRemoteCameraTrack] = useState<any>(null);
  const [screenRenderKey, setScreenRenderKey] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<{ id: string; sender: string; text: string }[]>([]);
  const [floatMsgs, setFloatMsgs] = useState<FloatMsg[]>([]);
  const [showLog, setShowLog] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const flatRef = useRef<FlatList>(null);
  const msgCounter = useRef(0);
  const removeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const applyRemoteTracks = useCallback(async () => {
    const lkRoom = roomRef.current;
    if (!lkRoom) return;
    const { screen, camera } = await collectRemoteVideoTracks(lkRoom);
    if (screen) {
      setRemoteScreenTrack((prev: any) => {
        if (prev?.sid !== screen.sid) setScreenRenderKey((k) => k + 1);
        return screen;
      });
    }
    if (camera) {
      setRemoteCameraTrack((prev: any) => (prev?.sid === camera.sid ? prev : camera));
    }
  }, []);

  const addMessage = useCallback((sender: string, text: string) => {
    const id = `msg_${++msgCounter.current}_${Date.now()}`;
    const anim = new Animated.Value(0);
    const opacity = new Animated.Value(1);

    const floatMsg: FloatMsg = { id, sender, text, anim, opacity };
    setFloatMsgs((prev) => [...prev.slice(-6), floatMsg]);
    setChatLog((prev) => [...prev.slice(-100), { id, sender, text }]);

    Animated.parallel([
      Animated.timing(anim, { toValue: -120, duration: 4000, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(2500),
        Animated.timing(opacity, { toValue: 0, duration: 1500, useNativeDriver: true }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      setFloatMsgs((prev) => prev.filter((m) => m.id !== id));
      removeTimersRef.current = removeTimersRef.current.filter((t) => t !== timer);
    }, 4200);
    removeTimersRef.current.push(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    const join = async () => {
      try {
        const statusRes = await fetch(
          `${API_URL}/api/call/livestream/${encodeURIComponent(String(streamerId))}/status`,
          { credentials: 'include' },
        );
        if (statusRes.ok && mounted) {
          const st = await statusRes.json().catch(() => ({}));
          if (st?.active === false) {
            if (mounted) navigation.goBack();
            return;
          }
        }
        const res = await fetch(`${API_URL}/api/call/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ type: 'viewer', targetId: streamerId }),
        });
        if (!res.ok || !mounted) return;
        const { token, livekitUrl } = await res.json();

        // Plain Room — same as group calls (adaptiveStream off for reliable screen decode).
        const lkRoom = new Room();
        roomRef.current = lkRoom;

        const onVideo = (track: any, pub: any) => {
          if (!mounted || track?.kind !== 'video' || !isVideoPublication(pub)) return;
          if (isScreenSharePublication(pub, track)) {
            setRemoteScreenTrack(track);
            setScreenRenderKey((k) => k + 1);
          } else {
            setRemoteCameraTrack(track);
          }
        };

        lkRoom.on(RoomEvent.TrackSubscribed, (track, pub) => onVideo(track, pub));
        lkRoom.on(RoomEvent.TrackPublished, (pub) => { void applyRemoteTracks(); });
        lkRoom.on(RoomEvent.ParticipantConnected, () => { void applyRemoteTracks(); });
        lkRoom.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
          if (track.kind !== 'video') return;
          if (isScreenSharePublication(pub, track)) setRemoteScreenTrack(null);
          else setRemoteCameraTrack(null);
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
        if (mounted) await applyRemoteTracks();

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
  }, [streamerId, navigation, addMessage, applyRemoteTracks]);

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

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !roomRef.current) return;
    const msg = { type: 'chat', sender: user?.name || user?.username || 'Viewer', text };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await roomRef.current.localParticipant.publishData(encoded, { reliable: true });
    addMessage(msg.sender, msg.text);
    setChatInput('');
  }, [chatInput, user, addMessage]);

  const screenSid = remoteScreenTrack?.sid || 'none';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.container}>
        <View style={styles.mediaWrap} pointerEvents="box-none">
          {remoteScreenTrack ? (
            <ScreenShareViewer
              key={`live-screen-${screenSid}-${screenRenderKey}`}
              videoTrack={remoteScreenTrack}
              label={streamerName || 'Live'}
              style={styles.screenStage}
              controlsBottom={76}
            />
          ) : remoteCameraTrack ? (
            <View style={styles.cameraFill} pointerEvents="none">
              <VideoView
                key={remoteCameraTrack?.sid || 'cam'}
                videoTrack={remoteCameraTrack}
                style={StyleSheet.absoluteFill}
                objectFit="contain"
                zOrder={0}
              />
            </View>
          ) : (
            <View style={styles.placeholder}>
              <Text style={{ color: '#888', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 }}>
                {isConnected ? 'Waiting for video…' : 'Connecting…'}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.topBar}>
          {streamerProfilePic ? <Image source={{ uri: streamerProfilePic }} style={styles.topAvatar} /> : null}
          <Text style={styles.topName}>{streamerName}</Text>
          <View style={styles.livePill}><Text style={styles.livePillText}>🔴 LIVE</Text></View>
          <TouchableOpacity style={[styles.topBtn, { backgroundColor: colors.error }]} onPress={() => navigation.goBack()}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>Leave</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.floatArea} pointerEvents="none">
          {floatMsgs.map((m) => <FloatingBubble key={m.id} msg={m} />)}
        </View>

        <TouchableOpacity
          style={[styles.logToggle, { backgroundColor: 'rgba(0,0,0,0.5)' }]}
          onPress={() => setShowLog((v) => !v)}
        >
          <Text style={{ color: '#fff', fontSize: 18 }}>💬</Text>
        </TouchableOpacity>

        {showLog && (
          <View style={[styles.logPanel, { backgroundColor: 'rgba(0,0,0,0.7)' }]}>
            <FlatList
              ref={flatRef}
              data={chatLog}
              keyExtractor={(item) => item.id}
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
          <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.primary }]} onPress={sendChat}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  mediaWrap:        {
    flex: 1,
    marginTop: 88,
    marginBottom: 58,
    backgroundColor: '#000',
  },
  screenStage:      {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  cameraFill:       { flex: 1, backgroundColor: '#000' },
  placeholder:      {
    flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#111',
  },
  placeholderAvatar:{ width: 100, height: 100, borderRadius: 50 },
  camPip:           {
    position: 'absolute', top: 90, right: 12,
    width: 96, height: 128, borderRadius: 12, overflow: 'hidden',
    backgroundColor: '#000', borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)',
    zIndex: 5,
  },
  avatarPlaceholder:{ justifyContent: 'center', alignItems: 'center' },
  topBar:           {
    position: 'absolute', top: 44, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 10,
  },
  topAvatar:        { width: 32, height: 32, borderRadius: 16 },
  topName:          { color: '#fff', fontWeight: 'bold', fontSize: 14, flex: 1 },
  livePill:         { backgroundColor: 'red', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  livePillText:     { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  topBtn:           { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 16 },
  floatArea:        { position: 'absolute', bottom: 80, left: 12, right: 12 },
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
    justifyContent: 'center', alignItems: 'center', zIndex: 10,
  },
  logPanel:         {
    position: 'absolute', bottom: 72, right: 60, left: 12,
    height: 180, borderRadius: 12, padding: 10, zIndex: 10,
  },
  inputRow:         {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 8, paddingHorizontal: 12,
    paddingVertical: 10, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10,
  },
  textInput:        {
    flex: 1, borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn:          { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, justifyContent: 'center' },
});

export default LiveViewerScreen;
