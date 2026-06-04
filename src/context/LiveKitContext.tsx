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
} from '../services/callData';
import { callSessionNav } from '../services/callSessionNav';
import { liveBroadcastNav } from '../services/liveBroadcastNav';

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
  /** When the callee’s phone rings, start fetching the join token immediately so Answer is not blocked on HTTP. */
  const incomingTokenPrefetchRef = useRef<{ key: string; promise: Promise<{ token: string; roomName: string; livekitUrl: string }> } | null>(null);

  const getLiveKitRoom = useCallback(() => roomRef.current, []);

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
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
      setRoom(null);
    }
    setLocalVideoTrack(null);
    setRemoteVideoTrack(null);
    setRemoteAudioTrack(null);
    setRemoteScreenTrack(null);
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    setConnectionState(ConnectionState.Disconnected);
    // Tear down the background-call foreground service (no longer in a call).
    stopOngoingCallNative();
  }, []);

  const startIncomingTokenPrefetch = useCallback((callerId: string, callType: 'audio' | 'video') => {
    const id = idStr(callerId);
    if (!id) return;
    const key = `${id}:${callType}`;
    incomingTokenPrefetchRef.current = { key, promise: fetchToken(id, callType) };
  }, [fetchToken]);

  // ── connect to room ──────────────────────────────────────────────────────
  const connectRoom = useCallback(async (token: string, livekitUrl: string, type: 'audio' | 'video') => {
    await disconnectRoom();

    const lkRoom = new Room();
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

    /** Callee may join before caller finishes connect — ParticipantConnected does NOT fire for remotes already in room. */
    const markConnectedIfRemotePresent = () => {
      if (lkRoom.remoteParticipants.size > 0) {
        setCallAccepted(true);
        setIsCalling(false);
      }
    };

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
        setIsCalling(false);
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
      markConnectedIfRemotePresent();
    });

    lkRoom.on(RoomEvent.Connected, () => {
      markConnectedIfRemotePresent();
      syncRemoteTracksFromRoom();
    });

    lkRoom.on(RoomEvent.ParticipantDisconnected, () => {
      handleCallEnded();
    });

    lkRoom.on(RoomEvent.Disconnected, () => {
      handleCallEnded();
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

    await lkRoom.connect(livekitUrl, token);

    // Keep the call alive when the app is backgrounded (home/app-switch). Started while the call
    // screen is in the foreground, so the typed (microphone) foreground service is allowed to start.
    startOngoingCallNative(callPartnerRef.current?.name, type === 'video');

    // If the caller already joined + published (common: they ring first), the room link is up and remotes
    // are present right after connect(). Mark connected NOW so the UI leaves "Connecting…" immediately,
    // BEFORE the slower mic/camera acquisition below.
    markConnectedIfRemotePresent();

    // Mic is essential + fast — enable it, but don't let it block the connected state.
    lkRoom.localParticipant.setMicrophoneEnabled(true).catch(() => {});
    if (type === 'video') {
      // Camera acquisition is the slowest step on many Android devices. Do NOT block the connect path on it
      // (it was adding seconds to "Connecting…"). The preview attaches via LocalTrackPublished /
      // syncLocalVideoFromParticipant when the track is ready.
      lkRoom.localParticipant
        .setCameraEnabled(true)
        .then(() => {
          syncLocalVideoFromParticipant();
          requestAnimationFrame(() => syncLocalVideoFromParticipant());
          setTimeout(() => syncLocalVideoFromParticipant(), 120);
          setTimeout(() => syncLocalVideoFromParticipant(), 450);
        })
        .catch(() => {});
    }

    // Re-check in case the remote joined while mic was being set up.
    markConnectedIfRemotePresent();
  }, [disconnectRoom]);

  // ── internal: mark call ended ────────────────────────────────────────────
  useEffect(() => {
    callAcceptedRef.current = callAccepted;
  }, [callAccepted]);

  const handleCallEnded = useCallback(() => {
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
    setIsCalling(false);
    setIsCallUIMinimized(false);
    setCall({});
    disconnectRoom();
    callPartnerRef.current = null;
    void onCallSessionEndedNative();
    setTimeout(() => setCallEnded(false), 400);
  }, [disconnectRoom, user, call.from]);

  const setIncomingCallFromNotification = useCallback(
    (callerId: string, callerName: string, callType: 'audio' | 'video', autoAnswer: boolean) => {
      const id = idStr(callerId);
      if (!id) return;
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
    [startIncomingTokenPrefetch],
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
    try {
      incomingTokenPrefetchRef.current = null;
      setIsCalling(true);
      setCallEnded(false);
      callPartnerRef.current = { id: userId, name: userName };

      const { token, livekitUrl, roomName } = await fetchToken(userId, type);
      roomNameForCancel = roomName || '';

      // Ring the callee immediately — do not wait for local camera/LiveKit connect (avoids timeouts).
      socket.emit('livekit:callUser', {
        userToCall:       userId,
        callerId:         myId,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
        roomName,
      });

      try { await liveBroadcastNav.endForCall?.(); } catch (_) {}

      await connectRoom(token, livekitUrl, type);
    } catch (err: any) {
      console.error('❌ [LiveKit Mobile] callUser error:', err?.message);
      setIsCalling(false);
      await disconnectRoom();
      if (socket && userId) {
        socket.emit('livekit:cancelCall', { userToCall: userId, roomName: roomNameForCancel });
      }
      throw err; // let ChatScreen catch and navigate back
    }
  }, [user, socket, fetchToken, connectRoom, disconnectRoom]);

  // ── PUBLIC: answerCall (receiver accepts) ────────────────────────────────
  const answerCall = useCallback(async () => {
    if (!call.from) return;
    if (callAcceptedRef.current || answerCallInFlightRef.current) return;
    if (roomRef.current && connectionState === ConnectionState.Connected) return;
    answerCallInFlightRef.current = true;
    try {
      try { await liveBroadcastNav.endForCall?.(); } catch (_) {}

      notificationAnswerCallerIdRef.current = null;
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
      await connectRoom(token, livekitUrl, type);
      setCallAccepted(true);
      setCall(prev => ({ ...prev, isReceivingCall: false }));
    } catch (err: any) {
      console.error('❌ [LiveKit Mobile] answerCall error:', err?.message);
      setCallAccepted(false);
      await disconnectRoom();
    } finally {
      answerCallInFlightRef.current = false;
    }
  }, [call, fetchToken, connectRoom, disconnectRoom, connectionState]);

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
      callPartnerRef.current = { id: data.from, name: data.callerName };
      setCallEnded(false);
    };

    const onCallCanceled = () => {
      const partnerId = callPartnerRef.current?.id;
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
      answerCallInFlightRef.current = false;
      incomingTokenPrefetchRef.current = null;
      setCall({});
      setIsCalling(false);
      setCallAccepted(false);
      disconnectRoom();
      callPartnerRef.current = null;
      setCallEnded(true);
      void onCallSessionEndedNative();
      setTimeout(() => setCallEnded(false), 400);
    };

    const onCallDeclined = () => {
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

    const bind = () => {
      try {
        socket.off('livekit:incomingCall', onIncomingCall);
        socket.off('livekit:callCanceled', onCallCanceled);
        socket.off('livekit:callDeclined', onCallDeclined);
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
      socket.off('callBusy', onCallBusy);
      socket.off('cancleCall', onCancleCall);
      socket.off('userBusyChess',      onGameBusy);
      socket.off('userBusyCard',       onGameBusy);
      socket.off('userBusyRace',       onGameBusy);
      socket.off('userAvailableChess', onGameAvailable);
      socket.off('userAvailableCard',  onGameAvailable);
      socket.off('userAvailableRace',  onGameAvailable);
    };
  }, [socket, disconnectRoom, handleCallEnded, startIncomingTokenPrefetch, user]);

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
