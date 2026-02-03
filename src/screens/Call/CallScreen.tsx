import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useWebRTC } from '../../context/WebRTCContext';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';

/**
 * Call flow (best practice):
 * - User A calls User B → A goes to CallScreen first (from ChatScreen), then callUser() runs.
 * - User A sees: Avatar + name + "Ringing…" + Cancel (WhatsApp style).
 * - User B receives socket "callUser" → AppNavigator opens CallScreen.
 * - User B sees: "Incoming call from {A name}" + Decline + Answer.
 * - When User B is OFF the app and gets the call on NATIVE UI, then presses Answer there:
 *   → App opens, navigates to CallScreen with shouldAutoAnswer=true.
 *   → Call auto-starts (answerCall runs when signal is available). User B does NOT press Answer again.
 */

const CallScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { colors } = useTheme();
  const { user } = useUser();
  const {
    localStream,
    remoteStream,
    call,
    callAccepted,
    callEnded,
    isCalling,
    callType,
    answerCall,
    leaveCall,
    toggleMute,
    toggleCamera,
    switchCamera,
    toggleSpeaker,
    isMuted,
    isCameraOff,
    isSpeakerOn,
    callDuration,
    callStartTimeRef,
    displayConnectedFromPeer,
    connectionState,
    setIncomingCallFromNotification,
    callBusyReason,
  } = useWebRTC();

  const params = route.params || {};
  const { userName, userId, userProfilePic, callType: paramCallType, shouldAutoAnswer, shouldDecline, isOutgoingCall, fromSocketIncoming } = params;
  const hasTriggeredNotificationRef = useRef(false);
  const hasDeclinedRef = useRef(false);
  const hasAutoAnsweredRef = useRef(false);
  const [durationSeconds, setDurationSeconds] = useState(0);
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set up call from notification (when navigated with userId/userName) and optionally auto-answer
  // Only for INCOMING calls from NOTIFICATION — NOT when: we're the caller (isOutgoingCall) OR we came from socket (fromSocketIncoming)
  // When fromSocketIncoming, callUser handler already set state with signal - do NOT overwrite (would clear signal → Answer fails)
  useEffect(() => {
    if (isOutgoingCall || fromSocketIncoming || !userId || !userName || hasTriggeredNotificationRef.current) return;
    const type = paramCallType === 'audio' ? 'audio' : 'video';
    hasTriggeredNotificationRef.current = true;
    setIncomingCallFromNotification(userId, userName, type, !!shouldAutoAnswer);
  }, [isOutgoingCall, fromSocketIncoming, userId, userName, paramCallType, shouldAutoAnswer, setIncomingCallFromNotification]);

  // When user B answered from NATIVE UI (Answer button): auto-start the call so they don't press Answer again.
  // WebRTCContext may auto-answer when callUser (with signal) arrives; this is a fallback when signal is already in state.
  useEffect(() => {
    if (!shouldAutoAnswer || callAccepted || hasAutoAnsweredRef.current) return;
    const receiving = call.isReceivingCall && !callAccepted;
    if (!receiving || !call.signal || !call.from) return;
    hasAutoAnsweredRef.current = true;
    const t = setTimeout(async () => {
      try {
        console.log('📞 [CallScreen] Auto-answering (native Answer → no second tap)');
        await answerCall(call.signal, call.from);
        console.log('✅ [CallScreen] Auto-answer completed');
      } catch (e) {
        console.warn('⚠️ [CallScreen] Auto-answer error:', e);
        hasAutoAnsweredRef.current = false;
      }
    }, 0);
    return () => clearTimeout(t);
  }, [shouldAutoAnswer, callAccepted, call.isReceivingCall, call.signal, call.from, answerCall]);

  // Decline on mount if requested
  useEffect(() => {
    if (shouldDecline && !hasDeclinedRef.current) {
      hasDeclinedRef.current = true;
      leaveCall();
      if (navigation.canGoBack()) navigation.goBack();
    }
  }, [shouldDecline, leaveCall, navigation]);

  // Duration ticker when call is connected (receiver: use connectionState when answered from native)
  useEffect(() => {
    const connected = displayConnectedFromPeer || (!!shouldAutoAnswer && connectionState === 'connected');
    if (!callAccepted || !connected) return;
    const update = () => {
      const startMs = callStartTimeRef.current;
      if (!startMs) return;
      setDurationSeconds(Math.floor((Date.now() - startMs) / 1000));
    };
    setDurationSeconds(0);
    update();
    durationIntervalRef.current = setInterval(update, 1000);
    return () => {
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    };
  }, [callAccepted, displayConnectedFromPeer, shouldAutoAnswer, connectionState, callStartTimeRef]);

  // Navigate back when call ends
  useEffect(() => {
    if (callEnded && navigation.canGoBack()) {
      navigation.goBack();
    }
  }, [callEnded, navigation]);

  // FIRM: Receiver (answered from notification) stuck on "Connecting" – end call after 12s if no connection
  const connectionFailsafeRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!answeredFromNative || isConnected) {
      if (connectionFailsafeRef.current) {
        clearTimeout(connectionFailsafeRef.current);
        connectionFailsafeRef.current = null;
      }
      return;
    }
    connectionFailsafeRef.current = setTimeout(() => {
      connectionFailsafeRef.current = null;
      console.warn('⚠️ [CallScreen] Connection failsafe – no connection after 12s, ending call');
      leaveCall();
      if (navigation.canGoBack()) navigation.goBack();
    }, 12000);
    return () => {
      if (connectionFailsafeRef.current) {
        clearTimeout(connectionFailsafeRef.current);
        connectionFailsafeRef.current = null;
      }
    };
  }, [answeredFromNative, isConnected, leaveCall, navigation]);

  const handleAnswer = async () => {
    try {
      await answerCall();
    } catch (e) {
      console.warn('Answer call error:', e);
    }
  };

  const handleLeave = () => {
    leaveCall();
    if (navigation.canGoBack()) navigation.goBack();
  };

  const formatDuration = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const isReceiving = call.isReceivingCall && !callAccepted;
  const isVideo = (paramCallType || callType || call.callType) === 'video';
  // When user answered from NATIVE UI (app was off), don't show in-app Answer/Decline — show Connecting until call is up.
  const answeredFromNative = !!shouldAutoAnswer;
  // Receiver (answered from notification): use connectionState so we show video + Connected when peer connects
  const isConnected = displayConnectedFromPeer || (answeredFromNative && connectionState === 'connected');

  // ——— User B (receiver): incoming call — show Decline + Answer (only when NOT already answered from native) ———
  if (isReceiving && !answeredFromNative) {
    const callerName = call.name || userName || 'Unknown';
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.incomingTitle, { color: colors.textGray }]}>
          Incoming call from
        </Text>
        <Text style={[styles.callerName, { color: colors.text }]}>
          {callerName}
        </Text>
        <Text style={[styles.callStatus, { color: colors.textGray }]}>
          {callBusyReason === 'offline'
            ? 'User is offline'
            : callBusyReason === 'busy'
              ? 'User is busy'
              : isVideo
                ? 'Video call'
                : 'Audio call'}
        </Text>
        <View style={styles.incomingActions}>
          <TouchableOpacity
            style={[styles.declineBtn, { backgroundColor: colors.error }]}
            onPress={handleLeave}
          >
            <Text style={styles.btnLabel}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.answerBtn, { backgroundColor: colors.success }]}
            onPress={handleAnswer}
          >
            <Text style={styles.btnLabel}>Answer</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ——— User B answered from native UI (app was off): show avatars + Connecting… until connected, then fall through to video UI ———
  if (isReceiving && answeredFromNative && !isConnected) {
    const callerName = call.name || userName || 'Unknown';
    const callerAvatar = userProfilePic || call.profilePic;
    const myName = user?.name || user?.username || 'You';
    const myAvatar = user?.profilePic;
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={styles.dualAvatarRow}>
          <View style={styles.connectedAvatarWrap}>
            {callerAvatar ? (
              <Image source={{ uri: callerAvatar }} style={styles.connectedAvatar} />
            ) : (
              <View style={[styles.connectedAvatar, styles.connectedAvatarPlaceholder, { backgroundColor: colors.border }]}>
                <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>
                  {callerName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={[styles.connectedAvatarLabel, { color: colors.textGray }]} numberOfLines={1}>
              {callerName}
            </Text>
          </View>
          <Text style={[styles.connectedVs, { color: colors.textGray }]}>•</Text>
          <View style={styles.connectedAvatarWrap}>
            {myAvatar ? (
              <Image source={{ uri: myAvatar }} style={styles.connectedAvatar} />
            ) : (
              <View style={[styles.connectedAvatar, styles.connectedAvatarPlaceholder, { backgroundColor: colors.border }]}>
                <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>
                  {myName.charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={[styles.connectedAvatarLabel, { color: colors.textGray }]} numberOfLines={1}>
              {myName}
            </Text>
          </View>
        </View>
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
        <Text style={[styles.connectingText, { color: colors.text }]}>Connecting…</Text>
        <TouchableOpacity style={[styles.hangUpBtn, { backgroundColor: colors.error, marginTop: 24 }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>End call</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ——— User A (caller): outgoing call — WhatsApp style: avatar + Ringing + Cancel ———
  // Show immediately when isOutgoingCall (before callUser runs at 300ms) to avoid old UI flash
  const isOutgoingRinging = (isCalling || isOutgoingCall) && !callAccepted && !call.isReceivingCall;
  if (isOutgoingRinging) {
    const calleeName = call.name || userName || '...';
    const avatarUri = userProfilePic || call.profilePic;
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {/* Avatar - large, centered like WhatsApp */}
        <View style={styles.outgoingAvatarWrap}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.outgoingAvatar} />
          ) : (
            <View style={[styles.outgoingAvatar, styles.outgoingAvatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[styles.outgoingAvatarText, { color: colors.textGray }]}>
                {calleeName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
        </View>
        <Text style={[styles.calleeName, { color: colors.text }]}>
          {calleeName}
        </Text>
        <Text style={[styles.ringingText, { color: colors.primary }]}>
          Ringing…
        </Text>
        <TouchableOpacity style={[styles.hangUpBtn, { backgroundColor: colors.error }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // In-call: video/audio UI
  const otherName = call.name || userName || 'User';
  const otherAvatar = userProfilePic || call.profilePic;
  const myName = user?.name || user?.username || 'You';
  const myAvatar = user?.profilePic;

  return (
    <View style={[styles.container, { backgroundColor: '#000' }]}>
      {/* Remote video (full screen) - video call only */}
      {isVideo && remoteStream && (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={styles.remoteVideo}
          objectFit="cover"
        />
      )}
      {isVideo && !remoteStream && (
        <View style={[styles.remoteVideo, styles.placeholder]}>
          <View style={styles.dualAvatarRow}>
            <View style={styles.connectedAvatarWrap}>
              {otherAvatar ? (
                <Image source={{ uri: otherAvatar }} style={styles.connectedAvatar} />
              ) : (
                <View style={[styles.connectedAvatar, styles.connectedAvatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>
                    {otherName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={[styles.connectedAvatarLabel, { color: colors.textGray }]} numberOfLines={1}>
                {otherName}
              </Text>
            </View>
            <Text style={[styles.connectedVs, { color: colors.textGray }]}>•</Text>
            <View style={styles.connectedAvatarWrap}>
              {myAvatar ? (
                <Image source={{ uri: myAvatar }} style={styles.connectedAvatar} />
              ) : (
                <View style={[styles.connectedAvatar, styles.connectedAvatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>
                    {myName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={[styles.connectedAvatarLabel, { color: colors.textGray }]} numberOfLines={1}>
                {myName}
              </Text>
            </View>
          </View>
          {isConnected ? (
            <>
              <Text style={[styles.connectedLabel, { color: colors.success }]}>Connected</Text>
              <Text style={styles.durationLarge}>{formatDuration(durationSeconds)}</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
              <Text style={[styles.connectingText, { color: colors.text }]}>Connecting...</Text>
            </>
          )}
        </View>
      )}

      {/* Local video (pip) - video call only */}
      {isVideo && localStream && (
        <View style={styles.localVideoWrap}>
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            mirror={true}
          />
        </View>
      )}

      {/* Audio call: center content - always show avatars; Connecting or Connected + timer */}
      {!isVideo && (
        <View style={styles.connectedContent}>
          {/* Both avatars - always visible */}
          <View style={styles.dualAvatarRow}>
            <View style={styles.connectedAvatarWrap}>
              {otherAvatar ? (
                <Image source={{ uri: otherAvatar }} style={styles.connectedAvatar} />
              ) : (
                <View style={[styles.connectedAvatar, styles.connectedAvatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>
                    {otherName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={[styles.connectedAvatarLabel, { color: colors.textGray }]} numberOfLines={1}>
                {otherName}
              </Text>
            </View>
            <Text style={[styles.connectedVs, { color: colors.textGray }]}>•</Text>
            <View style={styles.connectedAvatarWrap}>
              {myAvatar ? (
                <Image source={{ uri: myAvatar }} style={styles.connectedAvatar} />
              ) : (
                <View style={[styles.connectedAvatar, styles.connectedAvatarPlaceholder, { backgroundColor: colors.border }]}>
                  <Text style={[styles.connectedAvatarText, { color: colors.textGray }]}>
                    {myName.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}
              <Text style={[styles.connectedAvatarLabel, { color: colors.textGray }]} numberOfLines={1}>
                {myName}
              </Text>
            </View>
          </View>
          {isConnected ? (
            <>
              <Text style={[styles.connectedLabel, { color: colors.success }]}>Connected</Text>
              <Text style={styles.durationLarge}>{formatDuration(durationSeconds)}</Text>
            </>
          ) : (
            <>
              <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 16 }} />
              <Text style={[styles.connectingText, { color: colors.text }]}>Connecting...</Text>
            </>
          )}
        </View>
      )}

      {/* Top bar: duration (video only; audio shows in center) */}
      {isVideo && (
        <View style={styles.topBar}>
          <Text style={styles.durationText}>
            {isConnected ? formatDuration(durationSeconds) : 'Connecting...'}
          </Text>
        </View>
      )}

      {/* Bottom controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isMuted ? colors.error : colors.backgroundLight }]}
          onPress={toggleMute}
        >
          <Text style={styles.controlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        {isVideo && (
          <>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: isCameraOff ? colors.error : colors.backgroundLight }]}
              onPress={toggleCamera}
            >
              <Text style={styles.controlLabel}>{isCameraOff ? 'Camera On' : 'Camera Off'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: colors.backgroundLight }]}
              onPress={switchCamera}
            >
              <Text style={styles.controlLabel}>Flip</Text>
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity
          style={[styles.controlBtn, { backgroundColor: isSpeakerOn ? colors.primary : colors.backgroundLight }]}
          onPress={toggleSpeaker}
        >
          <Text style={styles.controlLabel}>Speaker</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.hangUpControlBtn, { backgroundColor: colors.error }]} onPress={handleLeave}>
          <Text style={styles.btnLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  incomingTitle: {
    fontSize: 16,
    color: '#8B98A5',
    marginTop: 24,
  },
  callerName: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 8,
  },
  callStatus: {
    fontSize: 16,
    marginTop: 8,
  },
  incomingActions: {
    flexDirection: 'row',
    marginTop: 32,
    gap: 24,
  },
  declineBtn: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  answerBtn: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  hangUpBtn: {
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    marginTop: 32,
  },
  outgoingAvatarWrap: {
    marginBottom: 24,
  },
  outgoingAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  outgoingAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  outgoingAvatarText: {
    fontSize: 48,
    fontWeight: '600',
  },
  calleeName: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  ringingText: {
    fontSize: 18,
    fontWeight: '500',
  },
  btnLabel: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  remoteVideo: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
  },
  placeholder: {
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  placeholderText: {
    color: '#888',
    fontSize: 16,
  },
  localVideoWrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 48,
    right: 16,
    width: 100,
    height: 140,
    borderRadius: 8,
    overflow: 'hidden',
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  connectedContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  dualAvatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    gap: 20,
  },
  connectedAvatarWrap: {
    alignItems: 'center',
  },
  connectedAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  connectedAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  connectedAvatarText: {
    fontSize: 32,
    fontWeight: '600',
  },
  connectedAvatarLabel: {
    fontSize: 12,
    marginTop: 6,
    maxWidth: 90,
  },
  connectedVs: {
    fontSize: 20,
  },
  connectedLabel: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  durationLarge: {
    color: '#FFF',
    fontSize: 28,
    fontWeight: '600',
  },
  connectingText: {
    fontSize: 18,
    marginTop: 16,
  },
  topBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 48,
    left: 16,
  },
  durationText: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '600',
  },
  controls: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 24,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 12,
    paddingHorizontal: 16,
  },
  controlBtn: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
  },
  controlLabel: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  hangUpControlBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 28,
  },
});

export default CallScreen;
