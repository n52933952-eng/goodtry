/**
 * LiveKitContext (Mobile) — replaces WebRTCContext.
 *
 * Keeps the same public API that CallScreen + ChatScreen already use:
 *   isCalling, callAccepted, callEnded, call, leaveCall
 *   callUser(userId, userName, type)
 *   answerCall()
 *
 * Extra additions for LiveKit:
 *   localVideoTrack, remoteVideoTrack, remoteAudioTrack (for CallScreen UI)
 *   busyUsers, isUserBusy (for ChatScreen busy check)
 */

import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback,
} from 'react';
import { DeviceEventEmitter, Alert } from 'react-native';
import {
  Room,
  RoomEvent,
  ParticipantEvent,
  ConnectionState,
  Track,
  LocalTrack,
  RemoteTrack,
  type RemoteParticipant,
  type LocalTrackPublication,
} from 'livekit-client';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import { API_URL } from '../utils/constants';
import {
  onCallSessionEndedNative, clearCallCancelFlagsNative,
  startOngoingCallNative, stopOngoingCallNative,
  clearCallData, getPendingCallData,
} from '../services/callData';
import { apiService } from '../services/api';
import { callSessionNav } from '../services/callSessionNav';

// ─── types ───────────────────────────────────────────────────────────────────
interface Call {
  isReceivingCall?: boolean;
  from?: string;
  name?: string;
  profilePic?: string;
  callType?: string;
  roomName?: string;
}

interface LiveKitContextType {
  // ── state (matches old WebRTCContext) ──
  call: Call;
  isCalling: boolean;
  callAccepted: boolean;
  callEnded: boolean;
  // ── actions (matches old WebRTCContext) ──
  callUser: (userId: string, userName: string, type: 'audio' | 'video') => Promise<void>;
  answerCall: () => Promise<void>;
  leaveCall: () => void;
  /** Cold start / FCM / native Answer — hydrate incoming ring before socket delivers livekit:incomingCall */
  setIncomingCallFromNotification: (
    callerId: string,
    callerName: string,
    callType: 'audio' | 'video',
    autoAnswer: boolean
  ) => void;
  getIncomingCallFromNotificationCallerId: () => string | null;
  // ── LiveKit tracks for UI ──
  localVideoTrack: LocalTrack | null;
  remoteVideoTrack: RemoteTrack | null;
  remoteAudioTrack: RemoteTrack | null;
  // ── screen sharing (Google Meet style) ──
  /** True when *I* am sharing my screen. */
  isScreenSharing: boolean;
  /** Start/stop sharing my screen (triggers the Android capture-permission dialog). */
  toggleScreenShare: () => Promise<void>;
  /** The other party's screen-share video track, shown full-screen when present. */
  remoteScreenTrack: RemoteTrack | null;
  room: Room | null;
  /** Prefer this for mic/camera actions — always the connected `Room` instance (state `room` can lag one frame). */
  getLiveKitRoom: () => Room | null;
  connectionState: ConnectionState;
  // ── busy users (same as mobile SocketContext busyUsers) ──
  busyUsers: Set<string>;
  isUserBusy: (userId: unknown) => boolean;
  /** User left CallScreen but call is still active (app home while sharing). */
  isCallUIMinimized: boolean;
  minimizeCallUI: () => void;
  openCallUI: () => Promise<void>;
  /** Re-attach camera/remote previews after app home or background (keeps minimized state). */
  refreshCallTracks: () => Promise<void>;
}

const LiveKitContext = createContext<LiveKitContextType | undefined>(undefined);

const idStr = (v: any): string => {
  if (!v) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object' && typeof v.toString === 'function') return String(v.toString()).trim();
  return String(v).trim();
};

const sortedRoomName = (a: string, b: string) => {
  const ids = [a, b].sort();
  return `call_${ids[0]}_${ids[1]}`;
};

const isIntentionalDisconnectError = (err: unknown): boolean => {
  const msg = (err as { message?: string })?.message || String(err ?? '');
  return /client initiated disconnect|connection (?:was )?abort|user initiated disconnect|cancel/i.test(msg);
};

const isCallSessionAborted = (
  sessionId: number,
  endedId: number,
  currentId: number,
): boolean => endedId === sessionId || currentId !== sessionId;

// ─── Provider ────────────────────────────────────────────────────────────────
export const LiveKitProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user }  = useUser();
  const socketCtx = useSocket();
  const socket    = socketCtx?.socket;

  // ── call state ──────────────────────────────────────────────────────────
  const [call,         setCall]         = useState<Call>({});
  const [isCalling,    setIsCalling]    = useState(false);
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded,    setCallEnded]    = useState(false);
  const [busyUsers,    setBusyUsers]    = useState<Set<string>>(new Set());

  // ── LiveKit room state ───────────────────────────────────────────────────
  const [room,              setRoom]              = useState<Room | null>(null);
  const [connectionState,   setConnectionState]   = useState<ConnectionState>(ConnectionState.Disconnected);
  const [localVideoTrack,   setLocalVideoTrack]   = useState<LocalTrack | null>(null);
  const [remoteVideoTrack,  setRemoteVideoTrack]  = useState<RemoteTrack | null>(null);
  const [remoteAudioTrack,  setRemoteAudioTrack]  = useState<RemoteTrack | null>(null);
  const [remoteScreenTrack, setRemoteScreenTrack] = useState<RemoteTrack | null>(null);
  const [isScreenSharing,   setIsScreenSharing]   = useState(false);
  const [isCallUIMinimized,   setIsCallUIMinimized]   = useState(false);
  const isScreenSharingRef = useRef(false);

  const roomRef        = useRef<Room | null>(null);
  const callPartnerRef = useRef<{ id: string; name: string } | null>(null);
  /** Set when user taps Answer on native UI / FCM — AppNavigator matches socket `from` for auto-route params */
  const notificationAnswerCallerIdRef = useRef<string | null>(null);
  const answerCallInFlightRef = useRef(false);
  const callAcceptedRef = useRef(false);
  const isCallingRef = useRef(false);
  const callReceivingRef = useRef(false);
  /** Ignore Disconnected while connectRoom is tearing down / handshaking a new room. */
  const isConnectingRoomRef = useRef(false);
  /** Serialize connectRoom — a second call must not disconnect the first mid-handshake. */
  const connectRoomSerialRef = useRef<Promise<void> | null>(null);
  /** Outgoing call room — ignore stale `callCanceled` from a previous session. */
  const activeCallRoomRef = useRef<string | null>(null);
  /** Monotonic id per ring/call attempt — stale decline/FCM from the previous attempt must not kill a recall. */
  const callSessionIdRef = useRef(0);
  const endedCallSessionIdRef = useRef(-1);
  const remoteEndIgnoreUntilRef = useRef(0);
  /** Debounce teardown — Android often logs "connection state mismatch" then recovers. */
  const endCallTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleCallEndedRef = useRef<() => void>(() => {});
  const incomingFromRef = useRef<string | null>(null);
  /** When the callee’s phone rings, start fetching the join token immediately so Answer is not blocked on HTTP. */
  const incomingTokenPrefetchRef = useRef<{ key: string; promise: Promise<{ token: string; roomName: string; livekitUrl: string }> } | null>(null);

  const getLiveKitRoom = useCallback(() => roomRef.current, []);

  const beginCallSession = useCallback(() => {
    callSessionIdRef.current += 1;
    endedCallSessionIdRef.current = -1;
    remoteEndIgnoreUntilRef.current = Date.now() + 1200;
    return callSessionIdRef.current;
  }, []);

  const canProcessRemoteEnd = useCallback(() => {
    if (callSessionIdRef.current <= 0) return false;
    if (endedCallSessionIdRef.current === callSessionIdRef.current) return false;
    if (Date.now() < remoteEndIgnoreUntilRef.current) return false;
    return true;
  }, []);

  const markCallSessionEnded = useCallback(() => {
    endedCallSessionIdRef.current = callSessionIdRef.current;
    remoteEndIgnoreUntilRef.current = Date.now() + 1500;
  }, []);

  const cancelScheduledCallEnd = useCallback(() => {
    if (endCallTimerRef.current) {
      clearTimeout(endCallTimerRef.current);
      endCallTimerRef.current = null;
    }
  }, []);

  const scheduleCallEnd = useCallback(
    (reason: string, delayMs = 4000) => {
      cancelScheduledCallEnd();
      endCallTimerRef.current = setTimeout(() => {
        endCallTimerRef.current = null;
        const live = roomRef.current;
        if (live?.state === ConnectionState.Connected) {
          console.log(`✅ [LiveKit] Connection recovered after ${reason}`);
          return;
        }
        if (!callAcceptedRef.current && !isCallingRef.current && !callReceivingRef.current) {
          return;
        }
        console.log(`📴 [LiveKit] Ending call after grace period (${reason})`);
        handleCallEndedRef.current();
      }, delayMs);
    },
    [cancelScheduledCallEnd],
  );

  // ── fetch token from backend ─────────────────────────────────────────────
  const fetchToken = useCallback(async (targetId: string, type: 'audio' | 'video') => {
    const res = await fetch(`${API_URL}/api/call/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'direct', targetId }),
    });
    if (!res.ok) throw new Error('Failed to get call token');
    return res.json() as Promise<{ token: string; roomName: string; livekitUrl: string }>;
  }, []);

  // ── disconnect room ──────────────────────────────────────────────────────
  const disconnectRoom = useCallback(async () => {
    cancelScheduledCallEnd();
    if (roomRef.current) {
      try {
        await roomRef.current.disconnect();
      } catch (_) {}
      roomRef.current = null;
    }
    setRoom(null);
    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    setRemoteAudioTrack(null);
    setRemoteScreenTrack(null);
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    setConnectionState(ConnectionState.Disconnected);
    // Tear down the background-call foreground service (no longer in a call).
    stopOngoingCallNative();
  }, [cancelScheduledCallEnd]);

  const startIncomingTokenPrefetch = useCallback((callerId: string, callType: 'audio' | 'video') => {
    const id = idStr(callerId);
    if (!id) return;
    const key = `${id}:${callType}`;
    incomingTokenPrefetchRef.current = { key, promise: fetchToken(id, callType) };
  }, [fetchToken]);

  // ── connect to room ──────────────────────────────────────────────────────
  const connectRoom = useCallback(async (token: string, livekitUrl: string, type: 'audio' | 'video') => {
    const run = async () => {
    const connectSessionId = callSessionIdRef.current;
    isConnectingRoomRef.current = true;
    try {
    await disconnectRoom();

    const lkRoom = new Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: false,
    });
    roomRef.current = lkRoom;
    setRoom(lkRoom);

    // Keep local camera preview resilient to Android publish/unpublish races.
    const syncLocalVideoFromParticipant = () => {
      try {
        const pub = lkRoom.localParticipant.getTrackPublication(Track.Source.Camera);
        const t = pub?.track as LocalTrack | undefined;
        if (t && t.kind === Track.Kind.Video) {
          setLocalVideoTrack(t);
        } else {
          setLocalVideoTrack(null);
        }
      } catch (_) {
        /* ignore */
      }
    };

    lkRoom.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      setConnectionState(state);
      if (state === ConnectionState.Connected) {
        syncLocalVideoFromParticipant();
      }
    });

    const syncRemoteTracksFromRoom = () => {
      let cam: RemoteTrack | null = null;
      let screen: RemoteTrack | null = null;
      let audio: RemoteTrack | null = null;
      lkRoom.remoteParticipants.forEach((participant) => {
        participant.trackPublications.forEach((pub) => {
          const t = pub.track;
          if (!t) return;
          if (t.kind === Track.Kind.Audio) {
            audio = t as RemoteTrack;
            return;
          }
          if (t.kind !== Track.Kind.Video) return;
          const isScreen = pub.source === Track.Source.ScreenShare;
          if (isScreen) screen = t as RemoteTrack;
          else cam = t as RemoteTrack;
        });
      });
      setRemoteVideoTrack(cam);
      setRemoteScreenTrack(screen);
      setRemoteAudioTrack(audio);
    };

    lkRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: any, participant: RemoteParticipant) => {
      if (!participant.isLocal) {
        setCallAccepted(true);
        callAcceptedRef.current = true;
        setIsCalling(false);
        isCallingRef.current = false;
      }
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.TrackUnsubscribed, () => {
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.TrackPublished, () => {
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.TrackUnpublished, () => {
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.ParticipantConnected, () => {
      setCallAccepted(true);
      callAcceptedRef.current = true;
      setIsCalling(false);
      isCallingRef.current = false;
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.Connected, () => {
      cancelScheduledCallEnd();
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.Reconnected, () => {
      cancelScheduledCallEnd();
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.ParticipantDisconnected, () => {
      // Do not tear down while still ringing alone in the room (Android can spuriously fire this).
      if (!callAcceptedRef.current) return;
      if (lkRoom.remoteParticipants.size > 0) return;
      handleCallEndedRef.current();
    });

    lkRoom.on(RoomEvent.Disconnected, () => {
      if (isConnectingRoomRef.current) return;
      // Match web flow but protect Android ring phase (connection state mismatch while alone in room).
      if (isCallingRef.current && !callAcceptedRef.current) return;
      if (callAcceptedRef.current) {
        scheduleCallEnd('room-disconnected', 2500);
      }
    });

    lkRoom.localParticipant.on(
      ParticipantEvent.LocalTrackPublished,
      (publication: LocalTrackPublication) => {
        if (publication.source !== Track.Source.Camera) return;
        const t = publication.track;
        if (t && t.kind === Track.Kind.Video) {
          setLocalVideoTrack(t as LocalTrack);
        } else {
          // Track can be attached a moment later on some devices.
          requestAnimationFrame(() => syncLocalVideoFromParticipant());
          setTimeout(() => syncLocalVideoFromParticipant(), 120);
        }
      },
    );

    lkRoom.localParticipant.on(ParticipantEvent.LocalTrackUnpublished, (publication: LocalTrackPublication) => {
      if (publication.source === Track.Source.Camera) {
        syncLocalVideoFromParticipant();
        setTimeout(() => syncLocalVideoFromParticipant(), 120);
        setTimeout(() => syncLocalVideoFromParticipant(), 450);
      }
      // Android can terminate MediaProjection without the user tapping "Stop share".
      // Keep isScreenSharing in sync so the UI shows the correct layout.
      if (publication.source === Track.Source.ScreenShare) {
        isScreenSharingRef.current = false;
        setIsScreenSharing(false);
      }
    });

    if (connectSessionId !== callSessionIdRef.current) {
      try { await lkRoom.disconnect(); } catch (_) {}
      return;
    }

    await lkRoom.connect(livekitUrl, token);

    if (connectSessionId !== callSessionIdRef.current) {
      try { await lkRoom.disconnect(); } catch (_) {}
      return;
    }

    // Keep the call alive when the app is backgrounded (home/app-switch). Started while the call
    // screen is in the foreground, so the typed (microphone) foreground service is allowed to start.
    startOngoingCallNative(callPartnerRef.current?.name, type === 'video');

    if (type === 'audio') {
      await lkRoom.localParticipant.setCameraEnabled(false);
      await lkRoom.localParticipant.setMicrophoneEnabled(true);
    } else {
    await lkRoom.localParticipant.setMicrophoneEnabled(true);
        await lkRoom.localParticipant.setCameraEnabled(true);
        syncLocalVideoFromParticipant();
    }
    } catch (err: unknown) {
      if (
        isCallSessionAborted(connectSessionId, endedCallSessionIdRef.current, callSessionIdRef.current)
        || isIntentionalDisconnectError(err)
      ) {
        return;
      }
      throw err;
    } finally {
      isConnectingRoomRef.current = false;
    }
    };

    const prev = connectRoomSerialRef.current;
    const next = prev ? prev.then(run, run) : run();
    connectRoomSerialRef.current = next;
    try {
      await next;
    } finally {
      if (connectRoomSerialRef.current === next) {
        connectRoomSerialRef.current = null;
      }
    }
  }, [disconnectRoom, cancelScheduledCallEnd, scheduleCallEnd]);

  // ── internal: mark call ended ────────────────────────────────────────────
  useEffect(() => {
    callAcceptedRef.current = callAccepted;
  }, [callAccepted]);

  useEffect(() => {
    isCallingRef.current = isCalling;
  }, [isCalling]);

  useEffect(() => {
    callReceivingRef.current = !!(call.isReceivingCall && call.from);
  }, [call.isReceivingCall, call.from]);

  useEffect(() => {
    const active = !!(
      isCalling
      || callAccepted
      || (call.isReceivingCall && call.from)
    );
    callSessionNav.setOneToOneCallSessionActive(active);
    return () => callSessionNav.setOneToOneCallSessionActive(false);
  }, [isCalling, callAccepted, call.isReceivingCall, call.from]);

  const handleCallEnded = useCallback(() => {
    markCallSessionEnded();
    cancelScheduledCallEnd();
    const partnerId = callPartnerRef.current?.id || call.from;
    const myId = user ? idStr(user._id) : '';
    if (partnerId || myId) {
      setBusyUsers(prev => {
        const n = new Set(prev);
        if (partnerId) n.delete(idStr(partnerId));
        if (myId) n.delete(myId);
        return n;
      });
      DeviceEventEmitter.emit('playsocial:clearCallBusy', {
        userToCall: partnerId || '',
        from:       myId || '',
      });
    }
    notificationAnswerCallerIdRef.current = null;
    answerCallInFlightRef.current = false;
    incomingTokenPrefetchRef.current = null;
    setCallEnded(true);
    setCallAccepted(false);
    callAcceptedRef.current = false;
    setIsCalling(false);
    isCallingRef.current = false;
    setIsCallUIMinimized(false);
    setCall({});
    callReceivingRef.current = false;
    activeCallRoomRef.current = null;
    disconnectRoom();
    callPartnerRef.current = null;
    void onCallSessionEndedNative();
    setTimeout(() => setCallEnded(false), 400);
  }, [disconnectRoom, user, call.from, cancelScheduledCallEnd, markCallSessionEnded]);

  useEffect(() => {
    handleCallEndedRef.current = handleCallEnded;
  }, [handleCallEnded]);

  const setIncomingCallFromNotification = useCallback(
    (callerId: string, callerName: string, callType: 'audio' | 'video', autoAnswer: boolean) => {
      const id = idStr(callerId);
      if (!id) return;
      beginCallSession();
      void clearCallCancelFlagsNative();
      DeviceEventEmitter.emit('playsocial:newIncomingRing', { callerId: id });
      setCallEnded(false);
      setCall({
        isReceivingCall: true,
        from:            id,
        name:            callerName || 'Unknown',
        profilePic:      undefined,
        callType:        callType,
        roomName:        '',
      });
      callPartnerRef.current = { id, name: callerName || 'Unknown' };
      if (autoAnswer) notificationAnswerCallerIdRef.current = id;
      startIncomingTokenPrefetch(id, callType);
    },
    [startIncomingTokenPrefetch, beginCallSession],
  );

  const getIncomingCallFromNotificationCallerId = useCallback(
    () => notificationAnswerCallerIdRef.current,
    [],
  );

  // ── PUBLIC: callUser (outgoing) ──────────────────────────────────────────
  const callUser = useCallback(async (userId: string, userName: string, type: 'audio' | 'video') => {
    if (!user || !socket) return;
    const myId = idStr(user._id);
    let roomNameForCancel = '';
    let didRing = false;
    const sessionId = beginCallSession();
    try {
      void clearCallCancelFlagsNative();
      DeviceEventEmitter.emit('playsocial:outgoingCallStarted');
      incomingTokenPrefetchRef.current = null;
      setIsCalling(true);
      isCallingRef.current = true;
      setCallEnded(false);
      callPartnerRef.current = { id: userId, name: userName };

      const room = sortedRoomName(myId, idStr(userId));
      roomNameForCancel = room;
      activeCallRoomRef.current = room;
      incomingFromRef.current = null;
      setCall((prev) => ({
        ...prev,
        roomName: room,
        callType: type,
      }));

      // Same order as web LiveKitContext.startCall: ring first, then fetch token + join room.
      socket.emit('livekit:callUser', {
        userToCall:       userId,
        callerId:         myId,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
        roomName:         room,
      });
      didRing = true;

      const { token, livekitUrl } = await fetchToken(userId, type);
      await connectRoom(token, livekitUrl, type);
    } catch (err: any) {
      if (sessionId !== callSessionIdRef.current) {
        console.log('⏸️ [LiveKit Mobile] callUser aborted — superseded by newer call session');
        return;
      }
      console.error('❌ [LiveKit Mobile] callUser error:', err?.message);
      setIsCalling(false);
      isCallingRef.current = false;
      await disconnectRoom();
      if (didRing && socket && userId) {
        socket.emit('livekit:cancelCall', { userToCall: userId, roomName: roomNameForCancel });
      }
      throw err; // let ChatScreen catch and navigate back
    }
  }, [user, socket, fetchToken, connectRoom, disconnectRoom, beginCallSession]);

  // ── PUBLIC: answerCall (receiver accepts) ────────────────────────────────
  const answerCall = useCallback(async () => {
    if (!call.from) return;
    if (callAcceptedRef.current || answerCallInFlightRef.current) return;
    if (roomRef.current?.state === ConnectionState.Connected) return;
    const sessionId = callSessionIdRef.current;
    answerCallInFlightRef.current = true;
    try {
      notificationAnswerCallerIdRef.current = null;
      setCallAccepted(true);
      callAcceptedRef.current = true;
      const type = (call.callType as 'audio' | 'video') || 'video';
      const fromId = idStr(call.from);
      const prefetchKey = `${fromId}:${type}`;
      const prefetch = incomingTokenPrefetchRef.current;
      let token: string;
      let livekitUrl: string;
      if (prefetch && prefetch.key === prefetchKey) {
        incomingTokenPrefetchRef.current = null;
        try {
          const bundle = await prefetch.promise;
          token = bundle.token;
          livekitUrl = bundle.livekitUrl;
        } catch {
          const bundle = await fetchToken(fromId, type);
          token = bundle.token;
          livekitUrl = bundle.livekitUrl;
        }
      } else {
        incomingTokenPrefetchRef.current = null;
        const bundle = await fetchToken(fromId, type);
        token = bundle.token;
        livekitUrl = bundle.livekitUrl;
      }
      if (isCallSessionAborted(sessionId, endedCallSessionIdRef.current, callSessionIdRef.current)) return;
      await connectRoom(token, livekitUrl, type);
      if (isCallSessionAborted(sessionId, endedCallSessionIdRef.current, callSessionIdRef.current)) return;
      setCall(prev => ({ ...prev, isReceivingCall: false }));
    } catch (err: unknown) {
      if (
        isCallSessionAborted(sessionId, endedCallSessionIdRef.current, callSessionIdRef.current)
        || isIntentionalDisconnectError(err)
      ) {
        console.log('⏸️ [LiveKit Mobile] answerCall stopped — call ended');
        return;
      }
      console.error('❌ [LiveKit Mobile] answerCall error:', (err as Error)?.message);
      setCallAccepted(false);
      callAcceptedRef.current = false;
      await disconnectRoom();
    } finally {
      answerCallInFlightRef.current = false;
    }
  }, [call, fetchToken, connectRoom, disconnectRoom]);

  // ── PUBLIC: toggleScreenShare (Google Meet style) ─────────────────────────
  // Android captures the WHOLE screen (no single-window capture on mobile). The first call
  // triggers the system MediaProjection consent dialog; LiveKit publishes a ScreenShare track.
  const resyncRemoteVideoFromRoom = useCallback((lk: Room, preserveExisting = false) => {
    let cam: RemoteTrack | null = null;
    let screen: RemoteTrack | null = null;
    let audio: RemoteTrack | null = null;
    let foundCam = false;
    let foundScreen = false;
    lk.remoteParticipants.forEach((participant) => {
      participant.trackPublications.forEach((pub) => {
        // Force re-subscribe if LiveKit adaptive-stream paused/unsubscribed the track.
        if (!pub.isSubscribed && pub.kind === Track.Kind.Video) {
          try { (pub as any).setSubscribed(true); } catch (_) {}
        }
        const t = pub.track;
        if (!t) return;
        if (t.kind === Track.Kind.Audio) {
          audio = t as RemoteTrack;
          return;
        }
        if (t.kind !== Track.Kind.Video) return;
        if (pub.source === Track.Source.ScreenShare) { screen = t as RemoteTrack; foundScreen = true; }
        else { cam = t as RemoteTrack; foundCam = true; }
      });
    });
    // When preserveExisting is true (e.g. called during camera restart), don't clear an
    // existing track to null — that would unmount the VideoView and trigger adaptive-stream
    // to pause the remote track, creating a loop.
    if (foundCam || !preserveExisting) setRemoteVideoTrack(cam);
    if (foundScreen || !preserveExisting) setRemoteScreenTrack(screen);
    setRemoteAudioTrack(audio);
  }, []);

  const syncCameraFromRoom = useCallback((lk: Room, preserveRemote = false) => {
    const pub = lk.localParticipant.getTrackPublication(Track.Source.Camera);
    const t = pub?.track as LocalTrack | undefined;
    if (t && t.kind === Track.Kind.Video) setLocalVideoTrack(t);
    resyncRemoteVideoFromRoom(lk, preserveRemote);
  }, [resyncRemoteVideoFromRoom]);

  const ensureCameraOn = useCallback(async (lk: Room) => {
    // Mirror the GROUP CALL behaviour, which works reliably: do NOT restart the
    // camera (no stop→start). The camera track stays published the whole time;
    // adaptive-stream is off (plain `new Room()`), so tracks are never dropped.
    // Just make sure the camera is enabled, then read the live tracks.
    const camPub = lk.localParticipant.getTrackPublication(Track.Source.Camera);
    if (!camPub?.track) {
      try { await lk.localParticipant.setCameraEnabled(true); } catch (_) {}
    }
    syncCameraFromRoom(lk, true);
  }, [syncCameraFromRoom]);

  const toggleScreenShare = useCallback(async () => {
    const lk = roomRef.current;
    if (!lk) return;
    const next = !isScreenSharingRef.current;
    try {
      await lk.localParticipant.setScreenShareEnabled(next);
      isScreenSharingRef.current = next;
      setIsScreenSharing(next);
      // IDENTICAL to the working group call: Android MediaProjection interrupts
      // the camera when screen share starts, so re-enable the camera right after.
      // Without this the local (and the remote's view of you) camera stays dead.
      try {
        await lk.localParticipant.setCameraEnabled(true);
      } catch (_) {}
      syncCameraFromRoom(lk);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('⚠️ [LiveKit] screen share toggle failed:', msg);
      isScreenSharingRef.current = false;
      setIsScreenSharing(false);
      try {
        await lk.localParticipant.setScreenShareEnabled(false);
        await lk.localParticipant.setCameraEnabled(true);
      } catch (_) {}
      if (next && !/cancel|denied|abort/i.test(msg)) {
        Alert.alert('Screen share', `Could not start screen sharing.\n\n${msg}`);
      }
    }
  }, [syncCameraFromRoom]);

  const minimizeCallUI = useCallback(() => {
    if (!callAcceptedRef.current) return;
    setIsCallUIMinimized(true);
    callSessionNav.minimizeToAppHome?.();
  }, []);

  const openCallUI = useCallback(async () => {
    // Mirror openGroupCallUI: just clear the minimized flag and READ the live
    // tracks. Do NOT re-enable the camera here — republishing on return makes
    // the preview flash and disappear. The camera was already re-enabled right
    // after the screen-share toggle, so it is still alive.
    setIsCallUIMinimized(false);
    const lk = roomRef.current;
    if (!lk) return;
    syncCameraFromRoom(lk, true);
  }, [syncCameraFromRoom]);

  const refreshCallTracks = useCallback(async () => {
    const lk = roomRef.current;
    if (!lk || !callAcceptedRef.current) return;
    await ensureCameraOn(lk);
  }, [ensureCameraOn]);

  // ── PUBLIC: leaveCall ────────────────────────────────────────────────────
  const leaveCall = useCallback(() => {
    const partnerId = callPartnerRef.current?.id || call.from;
    if (partnerId && socket) {
      socket.emit('livekit:cancelCall', {
        userToCall: partnerId,
        roomName:   call.roomName || '',
      });
    }
    handleCallEnded();
  }, [socket, call, handleCallEnded]);

  // ── Socket: receive incoming call ────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onIncomingCall = (data: any) => {
      beginCallSession();
      void clearCallCancelFlagsNative();
      DeviceEventEmitter.emit('playsocial:newIncomingRing', { callerId: data?.from });
      const ct: 'audio' | 'video' = data.callType === 'audio' ? 'audio' : 'video';
      startIncomingTokenPrefetch(data.from, ct);
      setCall({
        isReceivingCall: true,
        from:            data.from,
        name:            data.callerName,
        profilePic:      data.callerProfilePic,
        callType:        ct,
        roomName:        data.roomName,
      });
      callReceivingRef.current = true;
      callPartnerRef.current = { id: data.from, name: data.callerName };
      incomingFromRef.current = data.from ? String(data.from) : null;
      activeCallRoomRef.current = data.roomName ? String(data.roomName) : null;
      setCallEnded(false);
    };

    const onCallCanceled = (payload?: { roomName?: string; from?: string }) => {
      if (!canProcessRemoteEnd()) {
        console.log('⏸️ [LiveKit] Ignoring callCanceled — stale or already ended session');
        return;
      }
      const fromId = idStr(payload?.from);
      const partnerId = callPartnerRef.current?.id;
      const incomingFrom = incomingFromRef.current;
      // Web: only end if cancel is for THIS call partner (avoids stale cancels killing new calls).
      if (!fromId || (incomingFrom !== fromId && partnerId !== fromId)) {
        return;
      }
      const myId = user ? idStr(user._id) : '';
      if (partnerId || myId) {
        setBusyUsers(prev => {
          const n = new Set(prev);
          if (partnerId) n.delete(idStr(partnerId));
          if (myId) n.delete(myId);
          return n;
        });
        DeviceEventEmitter.emit('playsocial:clearCallBusy', {
          userToCall: partnerId || '',
          from:       myId || '',
        });
      }
      markCallSessionEnded();
      answerCallInFlightRef.current = false;
      incomingTokenPrefetchRef.current = null;
      setCall({});
      callReceivingRef.current = false;
      setIsCalling(false);
      isCallingRef.current = false;
      setCallAccepted(false);
      callAcceptedRef.current = false;
      activeCallRoomRef.current = null;
      disconnectRoom();
      callPartnerRef.current = null;
      setCallEnded(true);
      void onCallSessionEndedNative();
      setTimeout(() => setCallEnded(false), 400);
    };

    const onCallDeclined = (payload?: { roomName?: string }) => {
      if (!canProcessRemoteEnd()) {
        console.log('⏸️ [LiveKit] Ignoring callDeclined — stale or already ended session');
        return;
      }
      const activeRoom = activeCallRoomRef.current || call.roomName || '';
      const payloadRoom = payload?.roomName != null ? String(payload.roomName) : '';
      if (activeRoom && payloadRoom && payloadRoom !== activeRoom) {
        console.log('⏸️ [LiveKit] Ignoring callDeclined — different room');
        return;
      }
      handleCallEnded();
    };

    // Busy tracking (calls)
    const onCallBusy = ({ userToCall, from }: any) => {
      setBusyUsers(prev => {
        const n = new Set(prev);
        if (userToCall) n.add(idStr(userToCall));
        if (from)       n.add(idStr(from));
        return n;
      });
    };
    const onCancleCall = ({ userToCall, from }: any) => {
      setBusyUsers(prev => {
        const n = new Set(prev);
        if (userToCall) n.delete(idStr(userToCall));
        if (from)       n.delete(idStr(from));
        return n;
      });
    };
    // Busy tracking (games – chess / card / race)
    const onGameBusy = ({ userId }: any) => {
      if (!userId) return;
      setBusyUsers(prev => { const n = new Set(prev); n.add(idStr(userId)); return n; });
    };
    const onGameAvailable = ({ userId }: any) => {
      if (!userId) return;
      setBusyUsers(prev => { const n = new Set(prev); n.delete(idStr(userId)); return n; });
    };

    const onLegacyCallCanceled = () => {
      if (!canProcessRemoteEnd()) return;
      const active = isCallingRef.current || callReceivingRef.current || callAcceptedRef.current;
      if (!active) return;
      console.log('📴 [LiveKit] Legacy CallCanceled — ending active call session');
      handleCallEnded();
    };

    const bind = () => {
      try {
        socket.off('livekit:incomingCall', onIncomingCall);
        socket.off('livekit:callCanceled', onCallCanceled);
        socket.off('livekit:callDeclined', onCallDeclined);
        socket.off('CallCanceled', onLegacyCallCanceled);
        socket.off('callBusy', onCallBusy);
        socket.off('cancleCall', onCancleCall);
        socket.off('userBusyChess',      onGameBusy);
        socket.off('userBusyCard',       onGameBusy);
        socket.off('userBusyRace',       onGameBusy);
        socket.off('userAvailableChess', onGameAvailable);
        socket.off('userAvailableCard',  onGameAvailable);
        socket.off('userAvailableRace',  onGameAvailable);
      } catch (_) {
        /* ignore */
      }
      socket.on('livekit:incomingCall', onIncomingCall);
      socket.on('livekit:callCanceled', onCallCanceled);
      socket.on('livekit:callDeclined', onCallDeclined);
      socket.on('CallCanceled', onLegacyCallCanceled);
      socket.on('callBusy', onCallBusy);
      socket.on('cancleCall', onCancleCall);
      socket.on('userBusyChess',      onGameBusy);
      socket.on('userBusyCard',       onGameBusy);
      socket.on('userBusyRace',       onGameBusy);
      socket.on('userAvailableChess', onGameAvailable);
      socket.on('userAvailableCard',  onGameAvailable);
      socket.on('userAvailableRace',  onGameAvailable);
    };

    bind();
    const removeReady =
      typeof (socket as any).addSocketReadyListener === 'function'
        ? (socket as any).addSocketReadyListener(bind)
        : null;

    return () => {
      try {
        removeReady?.();
      } catch (_) {
        /* ignore */
      }
      socket.off('livekit:incomingCall', onIncomingCall);
      socket.off('livekit:callCanceled', onCallCanceled);
      socket.off('livekit:callDeclined', onCallDeclined);
      socket.off('CallCanceled', onLegacyCallCanceled);
      socket.off('callBusy', onCallBusy);
      socket.off('cancleCall', onCancleCall);
      socket.off('userBusyChess',      onGameBusy);
      socket.off('userBusyCard',       onGameBusy);
      socket.off('userBusyRace',       onGameBusy);
      socket.off('userAvailableChess', onGameAvailable);
      socket.off('userAvailableCard',  onGameAvailable);
      socket.off('userAvailableRace',  onGameAvailable);
    };
  }, [socket, disconnectRoom, handleCallEnded, startIncomingTokenPrefetch, user, beginCallSession, canProcessRemoteEnd, markCallSessionEnded]);

  // Push / native Decline: HTTP cancel already sent from Android — end caller ring via FCM.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CallEndedFromFCM', (payload: { callerId?: string }) => {
      const otherId = idStr(payload?.callerId);
      if (!otherId) return;
      const partnerId = callPartnerRef.current?.id;
      const incomingFrom = incomingFromRef.current;
      const matchesOutgoing = isCallingRef.current && partnerId && idStr(partnerId) === otherId;
      const matchesIncoming = callReceivingRef.current && incomingFrom && idStr(incomingFrom) === otherId;
      if (!matchesOutgoing && !matchesIncoming) return;
      if (!canProcessRemoteEnd()) {
        console.log('⏸️ [LiveKit] Ignoring CallEndedFromFCM — stale or new session', { otherId });
        return;
      }
      console.log('📴 [LiveKit] CallEndedFromFCM — other party ended/declined', { otherId });
      handleCallEnded();
    });
    return () => sub.remove();
  }, [handleCallEnded, canProcessRemoteEnd]);

  // Native Decline button (IncomingCallActivity / notification action) while JS is running.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CancelCallFromNotification', (data: { callerId?: string }) => {
      const callerId = idStr(data?.callerId);
      if (!callerId) return;
      console.log('📴 [LiveKit] CancelCallFromNotification — callee declined', { callerId });
      const room = activeCallRoomRef.current || call.roomName || '';
      const myId = user ? idStr(user._id) : '';
      if (socket?.isSocketConnected?.()) {
        socket.emit('livekit:declineCall', { callerId, roomName: room });
      } else if (myId) {
        void apiService.post('/api/call/cancel', { conversationId: callerId, sender: myId }).catch(() => {});
      }
      handleCallEnded();
      void clearCallData();
    });
    return () => sub.remove();
  }, [socket, user, call.roomName, handleCallEnded]);

  // Decline while app was killed: prefs still hold cancel — clear local ring state once on startup.
  const pendingDeclineCheckedRef = useRef(false);
  useEffect(() => {
    if (!socket || !user?._id || pendingDeclineCheckedRef.current) return;
    pendingDeclineCheckedRef.current = true;
    const checkPendingDecline = async () => {
      try {
        const pending = await getPendingCallData();
        if (!pending?.hasPendingCancel && !pending?.shouldCancelCall) return;
        const callerId = idStr(pending?.callerIdToCancel);
        if (!callerId) return;
        if (pending?.hasPendingCall && idStr(pending.callerId) === callerId) return;
        console.log('📴 [LiveKit] Pending decline from prefs — clearing ring state', { callerId });
        if (socket.isSocketConnected?.()) {
          socket.emit('livekit:declineCall', {
            callerId,
            roomName: activeCallRoomRef.current || '',
          });
        }
        handleCallEnded();
        await clearCallData();
      } catch (_) {
        /* ignore */
      }
    };
    void checkPendingDecline();
  }, [socket, user?._id, handleCallEnded]);

  const isUserBusy = useCallback((rawUserId: unknown): boolean => {
    const id = idStr(rawUserId);
    if (!id) return false;
    return busyUsers.has(id);
  }, [busyUsers]);

  return (
    <LiveKitContext.Provider value={{
      call, isCalling, callAccepted, callEnded,
      callUser, answerCall, leaveCall,
      setIncomingCallFromNotification,
      getIncomingCallFromNotificationCallerId,
      localVideoTrack, remoteVideoTrack, remoteAudioTrack,
      isScreenSharing, toggleScreenShare, remoteScreenTrack,
      room, getLiveKitRoom, connectionState,
      busyUsers, isUserBusy,
      isCallUIMinimized, minimizeCallUI, openCallUI, refreshCallTracks,
    }}>
      {children}
    </LiveKitContext.Provider>
  );
};

export const useLiveKit = () => {
  const ctx = useContext(LiveKitContext);
  if (!ctx) throw new Error('useLiveKit must be used within LiveKitProvider');
  return ctx;
};

// ── Drop-in alias so existing `useWebRTC()` calls work without renaming ──────
export const useWebRTC = useLiveKit;
export default LiveKitContext;
