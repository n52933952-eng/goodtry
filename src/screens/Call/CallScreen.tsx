import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
} from 'react-native';
import { VideoView, useLocalParticipant, useRemoteParticipants, useTracks } from '@livekit/react-native';
import { Track, ConnectionState, RoomEvent } from 'livekit-client';
import { useNavigation, useRoute } from '@react-navigation/native';
import InCallManager from 'react-native-incall-manager';
import { useWebRTC } from '../../context/LiveKitContext';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';

const idEq = (a: unknown, b: unknown) =>
  String(a ?? '').trim() === String(b ?? '').trim();

const CallScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const { user } = useUser();

  const {
    call,
    callAccepted,
    callEnded,
    isCalling,
    answerCall,
    leaveCall,
    room,
    connectionState,
    localVideoTrack,
    remoteVideoTrack,
  } = useWebRTC();

  const params = route.params || {};
  const {
    userName,
    userId,
    userProfilePic,
    callType: paramCallType,
    isOutgoingCall,
    shouldAutoAnswer,
    incomingCallKey,
  } = params;
  const autoAnswerStartedRef = useRef(false);

  // New ring while still on CallScreen (AppNavigator passes fresh incomingCallKey) — allow auto-answer again.
  useEffect(() => {
    autoAnswerStartedRef.current = false;
  }, [incomingCallKey]);

  // Native Answer / FCM: join room as soon as incoming state is ready (socket may arrive after hydrate).
  useEffect(() => {
    if (!shouldAutoAnswer || autoAnswerStartedRef.current) return;
    if (!call.isReceivingCall || !call.from) return;
    const routeOk = !userId || idEq(userId, call.from);
    if (!routeOk) return;
    autoAnswerStartedRef.current = true;
    void answerCall().catch(() => {
      autoAnswerStartedRef.current = false;
    });
  }, [shouldAutoAnswer, call.isReceivingCall, call.from, userId, answerCall, incomingCallKey]);

  // ── call control state ────────────────────────────────────────────────────
  const [isMuted,    setIsMuted]    = useState(false);
  const [isCamOff,  setIsCamOff]   = useState(false);
  const [isAnswering, setIsAnswering] = useState(false);
  /** Default to speaker for both voice/video calls for louder output (toggle still available). */
  const [isSpeaker, setIsSpeaker]  = useState(true);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const callStartRef   = useRef<number>(0);
  const durationRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const callWasActive  = useRef(false);

  const isVideo = (paramCallType || call.callType) === 'video';
  const isConnected = connectionState === ConnectionState.Connected && callAccepted;
  const [localPreviewFallbackTrack, setLocalPreviewFallbackTrack] = useState<any>(null);

  const syncLocalPreviewFallback = useCallback(() => {
    if (!room || !isVideo) {
      setLocalPreviewFallbackTrack(null);
      return;
    }
    try {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      const t = pub?.track;
      if (t && t.kind === Track.Kind.Video) {
        setLocalPreviewFallbackTrack(t);
      } else {
        setLocalPreviewFallbackTrack(null);
      }
    } catch (_) {
      setLocalPreviewFallbackTrack(null);
    }
  }, [room, isVideo]);

  useEffect(() => {
    syncLocalPreviewFallback();
    if (!room || !isVideo) return;

    const onPublished = () => syncLocalPreviewFallback();
    const onUnpublished = () => syncLocalPreviewFallback();
    const onConnState = () => syncLocalPreviewFallback();

    room.on(RoomEvent.LocalTrackPublished, onPublished);
    room.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
    room.on(RoomEvent.ConnectionStateChanged, onConnState);

    // Some Android devices restart camera track without a clean event sequence.
    const periodicSync = setInterval(syncLocalPreviewFallback, 700);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, onPublished);
      room.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
      room.off(RoomEvent.ConnectionStateChanged, onConnState);
      clearInterval(periodicSync);
    };
  }, [room, isVideo, callAccepted, syncLocalPreviewFallback]);

  const localTrackForPiP =
    localVideoTrack && localVideoTrack.kind === Track.Kind.Video
      ? localVideoTrack
      : localPreviewFallbackTrack;

  // Audio routing: voice → earpiece unless user toggles speaker; video → loudspeaker by default.
  useEffect(() => {
    if (!callAccepted) return;
    try {
      InCallManager.start({ media: isVideo ? 'video' : 'audio', auto: false, ringback: '' });
      InCallManager.setSpeakerphoneOn(!!isSpeaker);
      InCallManager.setForceSpeakerphoneOn(!!isSpeaker);
    } catch (_) {}
    return () => {
      try { InCallManager.stop(); } catch (_) {}
    };
  }, [callAccepted, isVideo, isSpeaker]);

  // ── duration ticker ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!callAccepted) return;
    callStartRef.current = Date.now();
    durationRef.current = setInterval(() => {
      setDurationSeconds(Math.floor((Date.now() - callStartRef.current) / 1000));
    }, 1000);
    return () => { if (durationRef.current) clearInterval(durationRef.current); };
  }, [callAccepted]);

  // ── track "was active" so we only navigate back when a real call ended ────
  useEffect(() => {
    if (isCalling || callAccepted) callWasActive.current = true;
  }, [isCalling, callAccepted]);

  useEffect(() => {
    if (callEnded && callWasActive.current && navigation.canGoBack()) {
      callWasActive.current = false;
      navigation.goBack();
    }
  }, [callEnded, navigation]);

  // ── auto-cancel: outgoing ring timeout 35s ────────────────────────────────
  const ringingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const isRinging = (isCalling || isOutgoingCall) && !callAccepted && !call.isReceivingCall;
    if (isRinging) {
      ringingTimeoutRef.current = setTimeout(() => {
        leaveCall();
        if (navigation.canGoBack()) navigation.goBack();
      }, 60000);
    }
    return () => { if (ringingTimeoutRef.current) clearTimeout(ringingTimeoutRef.current); };
  }, [isCalling, isOutgoingCall, callAccepted, call.isReceivingCall, leaveCall, navigation]);

  // ── controls ──────────────────────────────────────────────────────────────
  const handleMute = useCallback(async () => {
    if (!room) return;
    const next = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setIsMuted(next);
  }, [room, isMuted]);

  const handleCamToggle = useCallback(async () => {
    if (!room) return;
    const next = !isCamOff;
    await room.localParticipant.setCameraEnabled(!next);
    setIsCamOff(next);
  }, [room, isCamOff]);

  const handleFlipCamera = useCallback(async () => {
    if (!room) return;
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    await camPub?.track?.switchCamera?.();
  }, [room]);

  const handleSpeakerToggle = useCallback(() => {
    const next = !isSpeaker;
    setIsSpeaker(next);
    try {
      InCallManager.setSpeakerphoneOn(next);
      InCallManager.setForceSpeakerphoneOn(next);
    } catch (_) {}
  }, [isSpeaker]);

  const handleLeave = () => {
    leaveCall();
    if (navigation.canGoBack()) navigation.goBack();
  };

  const handleAnswer = async () => {
    if (isAnswering) return;
    setIsAnswering(true);
    try { await answerCall(); } catch (e) { console.warn('Answer error:', e); }
    finally { setIsAnswering(false); }
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const callerName    = call.name    || userName    || 'Unknown';
  const callerAvatar  = call.profilePic || userProfilePic;
  const myName        = user?.name   || user?.username || 'You';
  const myAvatar      = user?.profilePic;

  /** Already answered on native push / IncomingCallActivity — do not show a second Answer/Decline in RN. */
  const autoAnswerFromNative = shouldAutoAnswer === true;

  // ── Incoming after native Answer (FCM): single “Connecting…” screen ───────
  if (call.isReceivingCall && !callAccepted && autoAnswerFromNative) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.incomingTitle, { color: colors.textGray }]}>Connecting…</Text>
        {callerAvatar ? (
          <Image source={{ uri: callerAvatar }} style={styles.outgoingAvatar} />
        ) : (
          <View style={[styles.outgoingAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarInitial, { color: colors.textGray }]}>{callerName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={[styles.callerName, { color: colors.text }]}>{callerName}</Text>
        <Text style={[styles.callStatus, { color: colors.textGray }]}>
          {isVideo ? 'Starting video call' : 'Starting voice call'}
        </Text>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error, marginTop: 32 }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Incoming call: Decline + Answer (in-app ring only) ───────────────────
  if (call.isReceivingCall && !callAccepted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.incomingTitle, { color: colors.textGray }]}>Incoming call from</Text>
        {callerAvatar ? (
          <Image source={{ uri: callerAvatar }} style={styles.outgoingAvatar} />
        ) : (
          <View style={[styles.outgoingAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarInitial, { color: colors.textGray }]}>{callerName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={[styles.callerName, { color: colors.text }]}>{callerName}</Text>
        <Text style={[styles.callStatus, { color: colors.textGray }]}>
          {isVideo ? 'Video call' : 'Voice call'}
        </Text>
        <View style={styles.incomingActions}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error }]} onPress={handleLeave}>
            <Text style={styles.btnLabel}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.success, opacity: isAnswering ? 0.85 : 1 }]}
            onPress={handleAnswer}
            disabled={isAnswering}
          >
            {isAnswering ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnLabel}>Answer</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Outgoing: ringing ─────────────────────────────────────────────────────
  if ((isCalling || isOutgoingCall) && !callAccepted && !call.isReceivingCall) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {callerAvatar ? (
          <Image source={{ uri: callerAvatar }} style={styles.outgoingAvatar} />
        ) : (
          <View style={[styles.outgoingAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarInitial, { color: colors.textGray }]}>{callerName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={[styles.callerName, { color: colors.text }]}>{callerName}</Text>
        <Text style={[styles.ringingText, { color: colors.primary }]}>Ringing…</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error, marginTop: 32 }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Active call ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>

      {/* Remote video (full screen) */}
      {isVideo && remoteVideoTrack ? (
        <VideoView
          videoTrack={remoteVideoTrack}
          style={styles.remoteVideo}
          objectFit="cover"
          zOrder={0}
        />
      ) : (
        <View style={[styles.remoteVideo, styles.placeholder]}>
          <View style={styles.dualAvatarRow}>
            <View style={styles.avatarWrap}>
              {callerAvatar ? (
                <Image source={{ uri: callerAvatar }} style={styles.connectedAvatar} />
              ) : (
                <View style={[styles.connectedAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>{callerName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <Text style={[styles.connectedAvatarLabel, { color: '#fff' }]} numberOfLines={1}>{callerName}</Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 18, alignSelf: 'center' }}>•</Text>
            <View style={styles.avatarWrap}>
              {myAvatar ? (
                <Image source={{ uri: myAvatar }} style={styles.connectedAvatar} />
              ) : (
                <View style={[styles.connectedAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>{myName.charAt(0).toUpperCase()}</Text>
                </View>
              )}
              <Text style={[styles.connectedAvatarLabel, { color: '#fff' }]} numberOfLines={1}>{myName}</Text>
            </View>
          </View>
          {isConnected ? (
            <Text style={styles.durationLarge}>{formatDuration(durationSeconds)}</Text>
          ) : (
            <>
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
              <Text style={[styles.connectingText, { color: '#fff' }]}>Connecting…</Text>
            </>
          )}
        </View>
      )}

      {/* Local video PiP */}
      {isVideo && localTrackForPiP && (
        <View style={styles.localVideoWrap} pointerEvents="box-none">
          <VideoView
            videoTrack={localTrackForPiP}
            style={styles.localVideo}
            objectFit="cover"
            mirror
            zOrder={2}
          />
        </View>
      )}

      {/* Duration bar (video) */}
      {isVideo && callAccepted && (
        <View style={styles.topBar}>
          <Text style={styles.durationText}>
            {isConnected ? formatDuration(durationSeconds) : 'Connecting…'}
          </Text>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isMuted ? colors.error : colors.backgroundLight }]}
          onPress={handleMute}
        >
          <Text style={[styles.controlLabel, { color: isMuted ? '#fff' : colors.text }]}>
            {isMuted ? 'Unmute' : 'Mute'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isSpeaker ? colors.primary : colors.backgroundLight }]}
          onPress={handleSpeakerToggle}
        >
          <Text style={[styles.controlLabel, { color: isSpeaker ? '#fff' : colors.text }]}>
            {isSpeaker ? 'Speaker' : 'Earpiece'}
          </Text>
        </TouchableOpacity>

        {isVideo && (
          <>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: isCamOff ? colors.error : colors.backgroundLight }]}
              onPress={handleCamToggle}
            >
              <Text style={[styles.controlLabel, { color: isCamOff ? '#fff' : colors.text }]}>
                {isCamOff ? 'Cam On' : 'Cam Off'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: colors.backgroundLight }]}
              onPress={handleFlipCamera}
            >
              <Text style={[styles.controlLabel, { color: colors.text }]}>Flip</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={[styles.hangUpControlBtn, { backgroundColor: colors.error }]}
          onPress={handleLeave}
        >
          <Text style={styles.btnLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container:         { flex: 1, justifyContent: 'center', alignItems: 'center' },
  incomingTitle:     { fontSize: 16, marginTop: 24 },
  callerName:        { fontSize: 22, fontWeight: 'bold', marginTop: 12 },
  callStatus:        { fontSize: 16, marginTop: 8 },
  incomingActions:   { flexDirection: 'row', marginTop: 32, gap: 24 },
  btn:               { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  btnLabel:          { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  outgoingAvatar:    { width: 120, height: 120, borderRadius: 60 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarInitial:     { fontSize: 42, fontWeight: 'bold' },
  ringingText:       { fontSize: 18, marginTop: 12 },
  remoteVideo:       { ...StyleSheet.absoluteFillObject },
  placeholder:       { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  localVideoWrap:    {
    position: 'absolute', top: 60, right: 16,
    width: 100, height: 140, borderRadius: 12, overflow: 'hidden',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
  },
  localVideo:        { flex: 1 },
  topBar:            {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 48, paddingHorizontal: 16, alignItems: 'center',
  },
  durationText:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  controls:          {
    position: 'absolute', bottom: 40, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center',
    flexWrap: 'wrap', gap: 12, paddingHorizontal: 16,
  },
  controlBtn:        {
    paddingVertical: 10, paddingHorizontal: 16,
    borderRadius: 20, minWidth: 70, alignItems: 'center',
  },
  controlLabel:      { fontSize: 13, fontWeight: '600' },
  hangUpControlBtn:  {
    paddingVertical: 10, paddingHorizontal: 24,
    borderRadius: 20, alignItems: 'center',
  },
  dualAvatarRow:     { flexDirection: 'row', gap: 24, alignItems: 'center' },
  avatarWrap:        { alignItems: 'center', gap: 6 },
  connectedAvatar:   { width: 72, height: 72, borderRadius: 36 },
  connectedAvatarText: { fontSize: 28, fontWeight: 'bold' },
  connectedAvatarLabel: { color: '#fff', fontSize: 13, maxWidth: 80, textAlign: 'center' },
  connectingText:    { color: '#fff', fontSize: 16, marginTop: 8 },
  durationLarge:     { color: '#fff', fontSize: 24, fontWeight: '600', marginTop: 8 },
});

export default CallScreen;
