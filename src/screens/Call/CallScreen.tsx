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
  Dimensions,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { Track, ConnectionState, RoomEvent, LocalVideoTrack, facingModeFromLocalTrack, ParticipantEvent } from 'livekit-client';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import InCallManager from 'react-native-incall-manager';
import { useWebRTC } from '../../context/LiveKitContext';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';
import { moveAppToBackgroundNative } from '../../services/callData';
import ScreenShareViewer from '../../components/ScreenShareViewer';
import DraggableCallPip, { PIP_W, PIP_H } from '../../components/DraggableCallPip';

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
const { width: SW } = Dimensions.get('window');

const CallScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();
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

  const resolveCallRoom = useCallback(
    () => getLiveKitRoom() ?? room,
    [getLiveKitRoom, room],
  );

  // ── Direct track read (mirrors the working GROUP CALL approach) ───────────
  // Instead of trusting context state (which can go stale after backgrounding /
  // screen share), read the camera + screen tracks straight off the room's
  // participant objects, refreshed on LiveKit events + a periodic tick. Plain
  // `new Room()` has adaptive-stream OFF, so subscribed tracks are never dropped.
  const [directLocalCam, setDirectLocalCam] = useState<any>(null);
  const [directRemoteCam, setDirectRemoteCam] = useState<any>(null);
  const [directRemoteScreen, setDirectRemoteScreen] = useState<any>(null);
  // Bumping this remounts every VideoView so the native video surface re-attaches
  // to its (still-valid) track when we return to the screen. This is THE fix —
  // the group call does the same (LocalTile renderKey). Without it the surface
  // stays blank even though the track is present/subscribed/unmuted.
  const [videoRenderKey, setVideoRenderKey] = useState(0);
  const bumpVideoRenderKey = useCallback(() => setVideoRenderKey((k) => k + 1), []);

  const refreshAllTracks = useCallback(() => {
    const live = resolveCallRoom();
    if (!live) {
      setDirectLocalCam(null);
      setDirectRemoteCam(null);
      setDirectRemoteScreen(null);
      return;
    }
    try {
      const lpub = live.localParticipant.getTrackPublication(Track.Source.Camera);
      const lt = lpub?.track;
      setDirectLocalCam(lt && lt.kind === Track.Kind.Video ? lt : null);
    } catch (_) {
      setDirectLocalCam(null);
    }
    let cam: any = null;
    let screen: any = null;
    try {
      live.remoteParticipants.forEach((p: any) => {
        const cpub = p.getTrackPublication?.(Track.Source.Camera);
        if (cpub?.track) cam = cpub.track;
        const spub = p.getTrackPublication?.(Track.Source.ScreenShare);
        if (spub?.track) screen = spub.track;
      });
    } catch (_) { /* ignore */ }
    setDirectRemoteCam(cam);
    setDirectRemoteScreen(screen);
  }, [resolveCallRoom]);

  const syncLocalPreviewFallback = refreshAllTracks;

  useEffect(() => {
    refreshAllTracks();
    const live = resolveCallRoom();
    if (!live) return;

    const onChange = () => refreshAllTracks();

    live.on(RoomEvent.LocalTrackPublished, onChange);
    live.on(RoomEvent.LocalTrackUnpublished, onChange);
    live.on(RoomEvent.TrackSubscribed, onChange);
    live.on(RoomEvent.TrackUnsubscribed, onChange);
    live.on(RoomEvent.TrackPublished, onChange);
    live.on(RoomEvent.TrackUnpublished, onChange);
    live.on(RoomEvent.ConnectionStateChanged, onChange);

    // Some Android devices restart the camera track without a clean event
    // sequence — a periodic tick guarantees the VideoView fills back in.
    const periodicSync = setInterval(refreshAllTracks, 800);

    return () => {
      live.off(RoomEvent.LocalTrackPublished, onChange);
      live.off(RoomEvent.LocalTrackUnpublished, onChange);
      live.off(RoomEvent.TrackSubscribed, onChange);
      live.off(RoomEvent.TrackUnsubscribed, onChange);
      live.off(RoomEvent.TrackPublished, onChange);
      live.off(RoomEvent.TrackUnpublished, onChange);
      live.off(RoomEvent.ConnectionStateChanged, onChange);
      clearInterval(periodicSync);
    };
  }, [resolveCallRoom, callAccepted, refreshAllTracks]);

  // Re-read tracks when the app returns to the foreground (e.g. after browsing
  // the app while screen sharing). Direct read — no camera restart.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && callAccepted) {
        refreshAllTracks();
        bumpVideoRenderKey();
        setTimeout(() => { refreshAllTracks(); bumpVideoRenderKey(); }, 400);
      }
    });
    return () => sub.remove();
  }, [callAccepted, refreshAllTracks, bumpVideoRenderKey]);

  useEffect(() => {
    refreshAllTracks();
  }, [isScreenSharing, refreshAllTracks]);

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

  // Prefer the live, directly-read tracks; fall back to context state only if
  // the direct read hasn't populated yet (e.g. first render before the effect).
  const localTrackForPiP =
    directLocalCam ||
    (localVideoTrack && localVideoTrack.kind === Track.Kind.Video ? localVideoTrack : null);

  const remoteCamForPip = directRemoteCam || remoteVideoTrack;
  const effectiveRemoteScreen = directRemoteScreen || remoteScreenTrack;

  // `isVideo` is derived from route params / call.callType, which can be lost
  // when returning to the call via the mini-bar (navigate with no params, and
  // the caller never sets call.callType). So treat it as a video call whenever
  // real camera tracks are present — this keeps the camera row visible on return.
  const isVideoCall = isVideo || !!localTrackForPiP || !!remoteCamForPip;

  // True when a screen share is active on EITHER side.
  const anyScreenShare = isScreenSharing || !!effectiveRemoteScreen;
  const shareControlsBottom = anyScreenShare ? 196 : 112;
  // Show the two-camera row whenever anyone is sharing (you OR the other user).
  // Previously this was only `isScreenSharing`, so when the OTHER user shared,
  // their camera had nowhere to render and only your camera showed.
  const showShareCamRow = isVideoCall && callAccepted && anyScreenShare;
  const showCameraPips = false; // camera row replaces pips while sharing
  const showLocalPip =
    isVideoCall && callAccepted && !!localTrackForPiP && !isCamOff && !showCameraPips && !showShareCamRow;
  const [pipBounds, setPipBounds] = useState({ w: SW, h: 600 });

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
      // On return we only READ tracks (never setCameraEnabled — that republishes
      // and causes flash-then-disappear). The tracks stay valid; what they need
      // is the VideoView to REMOUNT so the native surface re-attaches. So bump
      // the render key on focus + a couple of follow-ups for slow re-attach.
      void openCallUI();
      refreshAllTracks();
      bumpVideoRenderKey();
      const t1 = setTimeout(() => { refreshAllTracks(); bumpVideoRenderKey(); }, 350);
      const t2 = setTimeout(() => { refreshAllTracks(); bumpVideoRenderKey(); }, 900);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }, [openCallUI, refreshAllTracks, bumpVideoRenderKey]),
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
      <View style={[styles.ringContainer, { backgroundColor: colors.background }]}>
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
      <View style={[styles.ringContainer, { backgroundColor: colors.background }]}>
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
      <View style={[styles.ringContainer, { backgroundColor: colors.background }]}>
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

      <View style={styles.mainStage}>
      {/* Remote screen only — never preview your own share (avoids infinite mirror) */}
      {effectiveRemoteScreen ? (
        <ScreenShareViewer
          videoTrack={effectiveRemoteScreen}
          label={CT.screenLabel}
          style={styles.screenStage}
          controlsBottom={shareControlsBottom}
        />
      ) : isScreenSharing ? (
        <View style={[styles.screenStage, styles.presentingStage]}>
          <Text style={styles.presentingTitle}>{CT.youArePresenting}</Text>
          <Text style={styles.presentingHint}>The other person can see your screen</Text>
        </View>
      ) : isVideoCall && remoteCamForPip ? (
        <VideoView
          key={`remote-main-${remoteCamForPip.sid ?? 'cam'}-${videoRenderKey}`}
          videoTrack={remoteCamForPip}
          style={StyleSheet.absoluteFillObject}
          objectFit="contain"
          zOrder={0}
        />
      ) : (
        <View style={[StyleSheet.absoluteFillObject, styles.placeholder]}>
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
      </View>

      {showShareCamRow && (
        <View style={styles.shareCamRow}>
          <View style={styles.shareCamBox}>
            {remoteCamForPip ? (
              <VideoView
                key={`share-remote-${remoteCamForPip.sid ?? 'r'}-${videoRenderKey}`}
                videoTrack={remoteCamForPip}
                style={styles.shareCamVideo}
                objectFit="cover"
                zOrder={2}
              />
            ) : (
              <View style={styles.shareCamPlaceholder}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
            <Text style={styles.shareCamLabel} numberOfLines={1}>{callerName}</Text>
          </View>
          <View style={styles.shareCamBox}>
            {!isCamOff && localTrackForPiP ? (
              <VideoView
                key={`share-local-${localTrackForPiP.sid ?? 'l'}-${videoRenderKey}`}
                videoTrack={localTrackForPiP}
                style={styles.shareCamVideo}
                objectFit="cover"
                mirror
                zOrder={2}
              />
            ) : (
              <View style={styles.shareCamPlaceholder}>
                <Text style={styles.shareCamOffText}>{isCamOff ? 'Cam off' : '…'}</Text>
              </View>
            )}
            <Text style={styles.shareCamLabel} numberOfLines={1}>{myName}</Text>
          </View>
        </View>
      )}

      {(showCameraPips || showLocalPip) && (
        <View
          style={styles.pipOverlay}
          pointerEvents="box-none"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            if (width > 0 && height > 0) setPipBounds({ w: width, h: height });
          }}
        >
          {showCameraPips && remoteCamForPip && (
            <DraggableCallPip
              bounds={pipBounds}
              label={callerName}
              initialX={SW - PIP_W - 16}
              initialY={56}
            >
              <VideoView
                key={`remote-pip-${remoteCamForPip.sid ?? 'cam'}-${videoRenderKey}`}
                videoTrack={remoteCamForPip}
                style={styles.pipVideo}
                objectFit="cover"
                zOrder={2}
              />
            </DraggableCallPip>
          )}
          {showCameraPips && localTrackForPiP && (
            <DraggableCallPip
              bounds={pipBounds}
              label={myName}
              initialX={16}
              initialY={56}
            >
              <VideoView
                key={`local-pip-${localTrackForPiP.sid ?? 'cam'}-${videoRenderKey}`}
                videoTrack={localTrackForPiP}
                style={styles.pipVideo}
                objectFit="cover"
                mirror
                zOrder={2}
              />
            </DraggableCallPip>
          )}
          {showLocalPip && (
            <DraggableCallPip bounds={pipBounds} label={myName} initialX={SW - PIP_W - 16} initialY={56}>
              <VideoView
                key={`local-pip-${localTrackForPiP.sid ?? 'cam'}-${videoRenderKey}`}
                videoTrack={localTrackForPiP}
                style={styles.pipVideo}
                objectFit="cover"
                mirror
                zOrder={2}
              />
            </DraggableCallPip>
          )}
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

      <View style={[styles.callFooter, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
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
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container:         { flex: 1 },
  ringContainer:     { flex: 1, justifyContent: 'center', alignItems: 'center' },
  mainStage:         { flex: 1, width: '100%' },
  pipVideo:          { width: '100%', height: '100%' },
  pipOverlay:        { ...StyleSheet.absoluteFillObject, zIndex: 20 },
  screenStage:       {
    flex: 1, width: '100%', margin: 8, borderRadius: 12,
    overflow: 'hidden', backgroundColor: '#000',
  },
  presentingStage:   {
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24,
    backgroundColor: '#000',
  },
  shareCamRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  shareCamBox: {
    flex: 1,
    height: 120,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  shareCamVideo: { width: '100%', height: '100%' },
  shareCamPlaceholder: {
    flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 90,
  },
  shareCamOffText: { color: '#888', fontSize: 12 },
  shareCamLabel: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  presentingTitle:   { color: '#fff', fontSize: 18, fontWeight: '700', textAlign: 'center' },
  presentingHint:    { color: 'rgba(255,255,255,0.65)', fontSize: 14, marginTop: 8, textAlign: 'center' },
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
  placeholder:       { backgroundColor: '#1a1a1a', justifyContent: 'center', alignItems: 'center' },
  topBar:            {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 48, paddingHorizontal: 16, alignItems: 'center',
  },
  durationText:      { color: '#fff', fontSize: 16, fontWeight: '600' },
  callFooter:        {
    width: '100%',
    backgroundColor: 'rgba(0,0,0,0.72)',
    paddingTop: 12,
    paddingHorizontal: 14,
    gap: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  controls:          {
    flexDirection: 'row', justifyContent: 'center',
    flexWrap: 'wrap', gap: 10,
  },
  shareLeaveRow:     {
    flexDirection: 'row', gap: 12,
  },
  shareLeaveBtn:     {
    flex: 1, alignItems: 'center', paddingVertical: 11,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)',
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
});

export default CallScreen;
