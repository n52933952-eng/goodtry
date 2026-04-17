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
import { DeviceEventEmitter } from 'react-native';
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
import { onCallSessionEndedNative, clearCallCancelFlagsNative } from '../services/callData';

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
  room: Room | null;
  connectionState: ConnectionState;
  // ── busy users (same as mobile SocketContext busyUsers) ──
  busyUsers: Set<string>;
  isUserBusy: (userId: unknown) => boolean;
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

  const roomRef        = useRef<Room | null>(null);
  const callPartnerRef = useRef<{ id: string; name: string } | null>(null);
  /** Set when user taps Answer on native UI / FCM — AppNavigator matches socket `from` for auto-route params */
  const notificationAnswerCallerIdRef = useRef<string | null>(null);
  const answerCallInFlightRef = useRef(false);
  const callAcceptedRef = useRef(false);
  /** When the callee’s phone rings, start fetching the join token immediately so Answer is not blocked on HTTP. */
  const incomingTokenPrefetchRef = useRef<{ key: string; promise: Promise<{ token: string; roomName: string; livekitUrl: string }> } | null>(null);

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
    setConnectionState(ConnectionState.Disconnected);
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
        const t = pub?.track;
        if (t && t.kind === Track.Kind.Video) {
          setLocalVideoTrack(t as LocalTrack);
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

    lkRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: any, participant: RemoteParticipant) => {
      if (!participant.isLocal) {
        setCallAccepted(true);
        setIsCalling(false);
      }
      if (track.kind === Track.Kind.Video) setRemoteVideoTrack(track);
      if (track.kind === Track.Kind.Audio) setRemoteAudioTrack(track);
    });

    lkRoom.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) setRemoteVideoTrack(null);
      if (track.kind === Track.Kind.Audio) setRemoteAudioTrack(null);
    });

    lkRoom.on(RoomEvent.ParticipantConnected, () => {
      markConnectedIfRemotePresent();
    });

    lkRoom.on(RoomEvent.Connected, () => {
      markConnectedIfRemotePresent();
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
        setLocalVideoTrack(null);
        // During restarts we may get unpublished then immediate republish.
        setTimeout(() => syncLocalVideoFromParticipant(), 120);
        setTimeout(() => syncLocalVideoFromParticipant(), 450);
      }
    });

    await lkRoom.connect(livekitUrl, token);

    await lkRoom.localParticipant.setMicrophoneEnabled(true);
    if (type === 'video') {
      try {
        await lkRoom.localParticipant.setCameraEnabled(true);
        syncLocalVideoFromParticipant();
        requestAnimationFrame(() => syncLocalVideoFromParticipant());
        setTimeout(() => syncLocalVideoFromParticipant(), 120);
        setTimeout(() => syncLocalVideoFromParticipant(), 450);
      } catch (_) {}
    }

    // If the other side connected first (common after early socket ring), remotes are already present.
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

    // Busy tracking
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

    const bind = () => {
      try {
        socket.off('livekit:incomingCall', onIncomingCall);
        socket.off('livekit:callCanceled', onCallCanceled);
        socket.off('livekit:callDeclined', onCallDeclined);
        socket.off('callBusy', onCallBusy);
        socket.off('cancleCall', onCancleCall);
      } catch (_) {
        /* ignore */
      }
      socket.on('livekit:incomingCall', onIncomingCall);
      socket.on('livekit:callCanceled', onCallCanceled);
      socket.on('livekit:callDeclined', onCallDeclined);
      socket.on('callBusy', onCallBusy);
      socket.on('cancleCall', onCancleCall);
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
      room, connectionState,
      busyUsers, isUserBusy,
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
