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
import { Alert } from 'react-native';
import {
  Room,
  RoomEvent,
  Track,
  LocalTrack,
  RemoteTrack,
  ConnectionState,
  type RemoteParticipant,
} from '@livekit/react-native';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import { API_URL } from '../utils/constants';

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

  // ── connect to room ──────────────────────────────────────────────────────
  const connectRoom = useCallback(async (token: string, livekitUrl: string, type: 'audio' | 'video') => {
    await disconnectRoom();

    const lkRoom = new Room();
    roomRef.current = lkRoom;
    setRoom(lkRoom);

    lkRoom.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      setConnectionState(state);
    });

    lkRoom.on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub: any, _participant: RemoteParticipant) => {
      if (track.kind === Track.Kind.Video) setRemoteVideoTrack(track);
      if (track.kind === Track.Kind.Audio) setRemoteAudioTrack(track);
    });

    lkRoom.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
      if (track.kind === Track.Kind.Video) setRemoteVideoTrack(null);
      if (track.kind === Track.Kind.Audio) setRemoteAudioTrack(null);
    });

    lkRoom.on(RoomEvent.ParticipantConnected, () => {
      setCallAccepted(true);
    });

    lkRoom.on(RoomEvent.ParticipantDisconnected, () => {
      handleCallEnded();
    });

    lkRoom.on(RoomEvent.Disconnected, () => {
      handleCallEnded();
    });

    await lkRoom.connect(livekitUrl, token);

    // Publish local tracks
    if (type === 'video') {
      await lkRoom.localParticipant.setCameraEnabled(true);
    }
    await lkRoom.localParticipant.setMicrophoneEnabled(true);

    // Expose local video track
    const localCam = lkRoom.localParticipant.getTrackPublication(Track.Source.Camera);
    if (localCam?.track) setLocalVideoTrack(localCam.track as LocalTrack);
  }, [disconnectRoom]);

  // ── internal: mark call ended ────────────────────────────────────────────
  const handleCallEnded = useCallback(() => {
    setCallEnded(true);
    setCallAccepted(false);
    setIsCalling(false);
    setCall({});
    disconnectRoom();
    callPartnerRef.current = null;
    setTimeout(() => setCallEnded(false), 400);
  }, [disconnectRoom]);

  // ── PUBLIC: callUser (outgoing) ──────────────────────────────────────────
  const callUser = useCallback(async (userId: string, userName: string, type: 'audio' | 'video') => {
    if (!user || !socket) return;
    const myId = idStr(user._id);
    try {
      setIsCalling(true);
      setCallEnded(false);
      callPartnerRef.current = { id: userId, name: userName };

      const { token, livekitUrl, roomName } = await fetchToken(userId, type);
      await connectRoom(token, livekitUrl, type);

      socket.emit('livekit:callUser', {
        userToCall:       userId,
        callerId:         myId,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
        roomName,
      });
    } catch (err: any) {
      console.error('❌ [LiveKit Mobile] callUser error:', err?.message);
      setIsCalling(false);
      await disconnectRoom();
      throw err; // let ChatScreen catch and navigate back
    }
  }, [user, socket, fetchToken, connectRoom, disconnectRoom]);

  // ── PUBLIC: answerCall (receiver accepts) ────────────────────────────────
  const answerCall = useCallback(async () => {
    if (!call.from) return;
    try {
      const type = (call.callType as 'audio' | 'video') || 'video';
      const { token, livekitUrl } = await fetchToken(call.from, type);
      await connectRoom(token, livekitUrl, type);
      setCallAccepted(true);
      setCall(prev => ({ ...prev, isReceivingCall: false }));
    } catch (err: any) {
      console.error('❌ [LiveKit Mobile] answerCall error:', err?.message);
      setCallAccepted(false);
      await disconnectRoom();
    }
  }, [call, fetchToken, connectRoom, disconnectRoom]);

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
      setCall({
        isReceivingCall: true,
        from:            data.from,
        name:            data.callerName,
        profilePic:      data.callerProfilePic,
        callType:        data.callType || 'video',
        roomName:        data.roomName,
      });
      callPartnerRef.current = { id: data.from, name: data.callerName };
      setCallEnded(false);
    };

    const onCallCanceled = () => {
      setCall({});
      setIsCalling(false);
      setCallAccepted(false);
      disconnectRoom();
      setCallEnded(true);
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

    socket.on('livekit:incomingCall',  onIncomingCall);
    socket.on('livekit:callCanceled',  onCallCanceled);
    socket.on('livekit:callDeclined',  onCallDeclined);
    socket.on('callBusy',              onCallBusy);
    socket.on('cancleCall',            onCancleCall);

    return () => {
      socket.off('livekit:incomingCall',  onIncomingCall);
      socket.off('livekit:callCanceled',  onCallCanceled);
      socket.off('livekit:callDeclined',  onCallDeclined);
      socket.off('callBusy',              onCallBusy);
      socket.off('cancleCall',            onCancleCall);
    };
  }, [socket, disconnectRoom, handleCallEnded]);

  const isUserBusy = useCallback((rawUserId: unknown): boolean => {
    const id = idStr(rawUserId);
    if (!id) return false;
    return busyUsers.has(id);
  }, [busyUsers]);

  return (
    <LiveKitContext.Provider value={{
      call, isCalling, callAccepted, callEnded,
      callUser, answerCall, leaveCall,
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
