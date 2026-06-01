import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  NativeModules,
  Platform,
  AppState,
} from 'react-native';
import { VideoView, useLocalParticipant, useRemoteParticipants, useTracks } from '@livekit/react-native';
import { Track, ConnectionState, RoomEvent, LocalVideoTrack, facingModeFromLocalTrack, ParticipantEvent } from 'livekit-client';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import InCallManager from 'react-native-incall-manager';
import { useWebRTC } from '../../context/LiveKitContext';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';
import { moveAppToBackgroundNative } from '../../services/callData';
import ScreenShareViewer from '../../components/ScreenShareViewer';

const idEq = (a: unknown, b: unknown) =>
  String(a ?? '').trim() === String(b ?? '').trim();

/**
 * Call UI follows the PHONE language (not the in-app toggle) so it matches the native
 * incoming-call screen + notification: Arabic phone → Arabic, every other language → English.
 */
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

const IS_ARABIC_DEVICE = getDeviceLanguage().startsWith('ar');

const CALL_TEXT = {
  en: {
    incomingCallFrom: 'Incoming call from',
    videoCall: 'Video call',
    voiceCall: 'Voice call',
    decline: 'Decline',
    answer: 'Answer',
    connecting: 'Connecting…',
    startingVideoCall: 'Starting video call',
    startingVoiceCall: 'Starting voice call',
    cancel: 'Cancel',
    ringing: 'Ringing…',
    end: 'End',
    mute: 'Mute',
    unmute: 'Unmute',
    speaker: 'Speaker',
    earpiece: 'Earpiece',
    camOn: 'Cam On',
    camOff: 'Cam Off',
    flip: 'Flip',
    share: 'Share',
    stopShare: 'Stop',
    screenLabel: 'Screen',
    youArePresenting: 'You are sharing your screen',
    appHome: 'App home',
    phoneHome: 'Phone',
  },
  ar: {
    incomingCallFrom: 'مكالمة واردة من',
    videoCall: 'مكالمة فيديو',
    voiceCall: 'مكالمة صوتية',
    decline: 'رفض',
    answer: 'رد',
    connecting: 'جارٍ الاتصال…',
    startingVideoCall: 'بدء مكالمة فيديو',
    startingVoiceCall: 'بدء مكالمة صوتية',
    cancel: 'إلغاء',
    ringing: 'يرن…',
    end: 'إنهاء',
    mute: 'كتم',
    unmute: 'إلغاء الكتم',
    speaker: 'مكبر الصوت',
    earpiece: 'سماعة الأذن',
    camOn: 'تشغيل الكاميرا',
    camOff: 'إيقاف الكاميرا',
    flip: 'تبديل',
    share: 'مشاركة',
    stopShare: 'إيقاف',
    screenLabel: 'الشاشة',
    youArePresenting: 'أنت تشارك شاشتك',
    appHome: 'الرئيسية',
    phoneHome: 'الهاتف',
  },
} as const;

const CT = IS_ARABIC_DEVICE ? CALL_TEXT.ar : CALL_TEXT.en;

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
    getLiveKitRoom,
    isScreenSharing,
    toggleScreenShare,
    remoteScreenTrack,
    minimizeCallUI,
    openCallUI,
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
  const [localPreviewKey, setLocalPreviewKey] = useState(0);

  const resolveCallRoom = useCallback(
    () => getLiveKitRoom() ?? room,
    [getLiveKitRoom, room],
  );

  const syncLocalPreviewFallback = useCallback(() => {
    const live = resolveCallRoom();
    if (!live || !isVideo) {
      setLocalPreviewFallbackTrack(null);
      return;
    }
    try {
      const pub = live.localParticipant.getTrackPublication(Track.Source.Camera);
      const t = pub?.track;
      if (t && t.kind === Track.Kind.Video) {
        setLocalPreviewFallbackTrack(t);
      } else {
        setLocalPreviewFallbackTrack(null);
      }
    } catch (_) {
      setLocalPreviewFallbackTrack(null);
    }
  }, [resolveCallRoom, isVideo]);

  useEffect(() => {
    syncLocalPreviewFallback();
    const live = resolveCallRoom();
    if (!live || !isVideo) return;

    const onPublished = () => syncLocalPreviewFallback();
    const onUnpublished = () => syncLocalPreviewFallback();
    const onConnState = () => syncLocalPreviewFallback();

    live.on(RoomEvent.LocalTrackPublished, onPublished);
    live.on(RoomEvent.LocalTrackUnpublished, onUnpublished);
    live.on(RoomEvent.ConnectionStateChanged, onConnState);

    // Some Android devices restart camera track without a clean event sequence.
    const periodicSync = setInterval(syncLocalPreviewFallback, 700);

    return () => {
      live.off(RoomEvent.LocalTrackPublished, onPublished);
      live.off(RoomEvent.LocalTrackUnpublished, onUnpublished);
      live.off(RoomEvent.ConnectionStateChanged, onConnState);
      clearInterval(periodicSync);
    };
  }, [resolveCallRoom, isVideo, callAccepted, syncLocalPreviewFallback]);

  // Re-attach local camera preview after leaving the app (screen share / home).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        syncLocalPreviewFallback();
        setLocalPreviewKey((k) => k + 1);
      }
    });
    return () => sub.remove();
  }, [syncLocalPreviewFallback]);

  // Keep Mute / Unmute label in sync with the real mic track (voice + video).
  useEffect(() => {
    const live = resolveCallRoom();
    if (!live) return;
    const lp = live.localParticipant;
    const syncMicUi = () => {
      try {
        const pub = lp.getTrackPublication(Track.Source.Microphone);
        const t = pub?.track;
        if (t && typeof t.isMuted === 'boolean') {
          setIsMuted(t.isMuted);
        }
      } catch (_) {
        /* ignore */
      }
    };
    syncMicUi();
    lp.on(ParticipantEvent.TrackMuted, syncMicUi);
    lp.on(ParticipantEvent.TrackUnmuted, syncMicUi);
    lp.on(ParticipantEvent.LocalTrackPublished, syncMicUi);
    return () => {
      lp.off(ParticipantEvent.TrackMuted, syncMicUi);
      lp.off(ParticipantEvent.TrackUnmuted, syncMicUi);
      lp.off(ParticipantEvent.LocalTrackPublished, syncMicUi);
    };
  }, [resolveCallRoom, callAccepted]);

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
    const liveRoom = resolveCallRoom();
    if (!liveRoom) return;
    const wantMuted = !isMuted;
    try {
      await liveRoom.localParticipant.setMicrophoneEnabled(!wantMuted);
      let pub = liveRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (wantMuted && pub && !pub.track) {
        await new Promise<void>((r) => setTimeout(r, 160));
        await liveRoom.localParticipant.setMicrophoneEnabled(false);
        pub = liveRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
      }
      const t = pub?.track;
      if (t && typeof t.isMuted === 'boolean') {
        setIsMuted(t.isMuted);
      } else {
        setIsMuted(wantMuted);
      }
    } catch (e) {
      console.warn('[CallScreen] mute toggle failed:', e);
    }
  }, [resolveCallRoom, isMuted]);

  const handleCamToggle = useCallback(async () => {
    const liveRoom = resolveCallRoom();
    if (!liveRoom) return;
    const next = !isCamOff;
    try {
      await liveRoom.localParticipant.setCameraEnabled(!next);
      setIsCamOff(next);
    } catch (e) {
      console.warn('[CallScreen] camera toggle failed:', e);
    }
  }, [resolveCallRoom, isCamOff]);

  const handleFlipCamera = useCallback(async () => {
    const liveRoom = resolveCallRoom();
    if (!liveRoom) return;
    const camPub = liveRoom.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = camPub?.track;
    if (!track || track.kind !== Track.Kind.Video) return;
    const video = track as LocalVideoTrack;
    if (typeof video.restartTrack !== 'function') return;
    try {
      const { facingMode: current } = facingModeFromLocalTrack(video);
      const next: 'user' | 'environment' =
        current === 'environment' ? 'user' : 'environment';
      await video.restartTrack({ facingMode: next });
      syncLocalPreviewFallback();
    } catch (e) {
      console.warn('[CallScreen] flip camera failed:', e);
    }
  }, [resolveCallRoom, syncLocalPreviewFallback]);

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

  const goAppHomeWhileSharing = useCallback(() => {
    minimizeCallUI();
  }, [minimizeCallUI]);

  useFocusEffect(
    useCallback(() => {
      openCallUI();
    }, [openCallUI]),
  );

  const goPhoneHomeWhileSharing = useCallback(async () => {
    if (Platform.OS === 'android') {
      await moveAppToBackgroundNative();
    }
  }, []);

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
        <Text style={[styles.incomingTitle, { color: colors.textGray }]}>{CT.connecting}</Text>
        {callerAvatar ? (
          <Image source={{ uri: callerAvatar }} style={styles.outgoingAvatar} />
        ) : (
          <View style={[styles.outgoingAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarInitial, { color: colors.textGray }]}>{callerName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={[styles.callerName, { color: colors.text }]}>{callerName}</Text>
        <Text style={[styles.callStatus, { color: colors.textGray }]}>
          {isVideo ? CT.startingVideoCall : CT.startingVoiceCall}
        </Text>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 24 }} />
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error, marginTop: 32 }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>{CT.cancel}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Incoming call: Decline + Answer (in-app ring only) ───────────────────
  if (call.isReceivingCall && !callAccepted) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.incomingTitle, { color: colors.textGray }]}>{CT.incomingCallFrom}</Text>
        {callerAvatar ? (
          <Image source={{ uri: callerAvatar }} style={styles.outgoingAvatar} />
        ) : (
          <View style={[styles.outgoingAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarInitial, { color: colors.textGray }]}>{callerName.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <Text style={[styles.callerName, { color: colors.text }]}>{callerName}</Text>
        <Text style={[styles.callStatus, { color: colors.textGray }]}>
          {isVideo ? CT.videoCall : CT.voiceCall}
        </Text>
        <View style={styles.incomingActions}>
          <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error }]} onPress={handleLeave}>
            <Text style={styles.btnLabel}>{CT.decline}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.btn, { backgroundColor: colors.success, opacity: isAnswering ? 0.85 : 1 }]}
            onPress={handleAnswer}
            disabled={isAnswering}
          >
            {isAnswering ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnLabel}>{CT.answer}</Text>}
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
        <Text style={[styles.ringingText, { color: colors.primary }]}>{CT.ringing}</Text>
        <TouchableOpacity style={[styles.btn, { backgroundColor: colors.error, marginTop: 32 }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>{CT.cancel}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Active call ───────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>

      {/* Remote screen share takes priority over the camera (Google Meet style) */}
      {remoteScreenTrack ? (
        <ScreenShareViewer
          videoTrack={remoteScreenTrack}
          label={CT.screenLabel}
          style={styles.remoteVideo}
        />
      ) : isVideo && remoteVideoTrack ? (
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
              <Text style={[styles.connectingText, { color: '#fff' }]}>{CT.connecting}</Text>
            </>
          )}
        </View>
      )}

      {/* Local video PiP */}
      {isVideo && localTrackForPiP && (
        <View style={styles.localVideoWrap} pointerEvents="box-none">
          <VideoView
            key={`local-pip-${localTrackForPiP.sid ?? 'cam'}-${localPreviewKey}`}
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
            {isConnected ? formatDuration(durationSeconds) : CT.connecting}
          </Text>
        </View>
      )}

      {isScreenSharing && (
        <View style={styles.shareLeaveRow}>
          <TouchableOpacity style={styles.shareLeaveBtn} onPress={goAppHomeWhileSharing}>
            <Text style={styles.shareLeaveText}>🏠 {CT.appHome}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.shareLeaveBtn} onPress={goPhoneHomeWhileSharing}>
            <Text style={styles.shareLeaveText}>↓ {CT.phoneHome}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isMuted ? colors.error : colors.backgroundLight }]}
          onPress={handleMute}
        >
          <Text style={[styles.controlLabel, { color: isMuted ? '#fff' : colors.text }]}>
            {isMuted ? CT.unmute : CT.mute}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isSpeaker ? colors.primary : colors.backgroundLight }]}
          onPress={handleSpeakerToggle}
        >
          <Text style={[styles.controlLabel, { color: isSpeaker ? '#fff' : colors.text }]}>
            {isSpeaker ? CT.speaker : CT.earpiece}
          </Text>
        </TouchableOpacity>

        {isVideo && (
          <>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: isCamOff ? colors.error : colors.backgroundLight }]}
              onPress={handleCamToggle}
            >
              <Text style={[styles.controlLabel, { color: isCamOff ? '#fff' : colors.text }]}>
                {isCamOff ? CT.camOn : CT.camOff}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: colors.backgroundLight }]}
              onPress={handleFlipCamera}
            >
              <Text style={[styles.controlLabel, { color: colors.text }]}>{CT.flip}</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isScreenSharing ? colors.primary : colors.backgroundLight }]}
          onPress={toggleScreenShare}
        >
          <Text style={[styles.controlLabel, { color: isScreenSharing ? '#fff' : colors.text }]}>
            {isScreenSharing ? CT.stopShare : CT.share}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.hangUpControlBtn, { backgroundColor: colors.error }]}
          onPress={handleLeave}
        >
          <Text style={styles.btnLabel}>{CT.end}</Text>
        </TouchableOpacity>
      </View>

      {isScreenSharing && (
        <View style={styles.presentingBanner}>
          <Text style={styles.presentingText}>{CT.youArePresenting}</Text>
        </View>
      )}
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
  shareLeaveRow:     {
    position: 'absolute', bottom: 118, left: 16, right: 16,
    flexDirection: 'row', gap: 10,
  },
  shareLeaveBtn:     {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
  },
  shareLeaveText:    { color: '#fff', fontSize: 13, fontWeight: '600' },
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
  screenBadge:       {
    position: 'absolute', top: 48, left: 16,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  screenBadgeText:   { color: '#fff', fontSize: 12, fontWeight: '600' },
  presentingBanner:  {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 48, paddingBottom: 8, paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center',
  },
  presentingText:    { color: '#fff', fontSize: 13, fontWeight: '600' },
});

export default CallScreen;
