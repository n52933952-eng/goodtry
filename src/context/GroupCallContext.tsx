/**
 * GroupCallContext (Mobile) — WhatsApp-style group calling.
 *
 * Public API:
 *   startGroupCall(conversationId, type)
 *   joinGroupCall()
 *   declineGroupCall()
 *   leaveGroupCall()
 *   incomingGroupCall   | null
 *   groupCallActive     boolean
 *   groupCallType       'video' | 'audio'
 *   participants        RemoteParticipant[]
 *   room                Room | null
 */

import React, {
  createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode,
} from 'react';
import { Alert } from 'react-native';
import {
  Room, RoomEvent, Track, ConnectionState,
  type RemoteParticipant,
} from '@livekit/react-native';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import { API_URL } from '../utils/constants';

interface IncomingGroupCall {
  conversationId: string;
  roomName:       string;
  callerId:       string;
  callerName:     string;
  callerProfilePic?: string;
  callType:       'audio' | 'video';
}

interface GroupCallContextType {
  incomingGroupCall: IncomingGroupCall | null;
  groupCallActive:   boolean;
  groupCallType:     'audio' | 'video';
  participants:      RemoteParticipant[];
  room:              Room | null;
  activeConvId:      string;
  startGroupCall:    (conversationId: string, type?: 'audio' | 'video') => Promise<void>;
  joinGroupCall:     () => Promise<void>;
  declineGroupCall:  () => void;
  leaveGroupCall:    () => void;
}

export const GroupCallContext = createContext<GroupCallContextType | undefined>(undefined);

export const GroupCallProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user }  = useUser();
  const socketCtx = useSocket();
  const socket    = socketCtx?.socket;

  const [incomingGroupCall, setIncomingGroupCall] = useState<IncomingGroupCall | null>(null);
  const [groupCallActive,   setGroupCallActive]   = useState(false);
  const [groupCallType,     setGroupCallType]      = useState<'audio' | 'video'>('video');
  const [participants,      setParticipants]       = useState<RemoteParticipant[]>([]);
  const [activeConvId,      setActiveConvId]       = useState('');
  const [room,              setRoom]              = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);

  // ── fetch token ────────────────────────────────────────────────────────────
  const fetchToken = useCallback(async (conversationId: string) => {
    const res = await fetch(`${API_URL}/api/call/token`, {
      method:      'POST',
      headers:     { 'Content-Type': 'application/json' },
      credentials: 'include',
      body:        JSON.stringify({ type: 'group', conversationId }),
    });
    if (!res.ok) throw new Error('Failed to get group call token');
    return res.json() as Promise<{ token: string; roomName: string; livekitUrl: string }>;
  }, []);

  // ── disconnect ─────────────────────────────────────────────────────────────
  const disconnectRoom = useCallback(async () => {
    if (roomRef.current) {
      try { await roomRef.current.disconnect(); } catch (_) {}
      roomRef.current = null;
      setRoom(null);
    }
    setParticipants([]);
  }, []);

  // ── connect ────────────────────────────────────────────────────────────────
  const connectGroupRoom = useCallback(async (token: string, livekitUrl: string, type: 'audio' | 'video') => {
    await disconnectRoom();
    const lkRoom = new Room();
    roomRef.current = lkRoom;
    setRoom(lkRoom);

    const refresh = () => setParticipants([...lkRoom.remoteParticipants.values()]);

    lkRoom.on(RoomEvent.ParticipantConnected,    refresh);
    lkRoom.on(RoomEvent.ParticipantDisconnected, refresh);
    lkRoom.on(RoomEvent.TrackSubscribed,         refresh);
    lkRoom.on(RoomEvent.TrackUnsubscribed,       refresh);
    lkRoom.on(RoomEvent.Disconnected, () => {
      setGroupCallActive(false);
      setParticipants([]);
      setRoom(null);
      roomRef.current = null;
    });

    await lkRoom.connect(livekitUrl, token);
    if (type !== 'audio') await lkRoom.localParticipant.setCameraEnabled(true);
    await lkRoom.localParticipant.setMicrophoneEnabled(true);
    refresh();
  }, [disconnectRoom]);

  // ── PUBLIC: start group call ───────────────────────────────────────────────
  const startGroupCall = useCallback(async (conversationId: string, type: 'audio' | 'video' = 'video') => {
    if (!user || !socket) return;
    try {
      const { token, roomName, livekitUrl } = await fetchToken(conversationId);
      await connectGroupRoom(token, livekitUrl, type);
      setGroupCallActive(true);
      setGroupCallType(type);
      setActiveConvId(conversationId);

      socket.emit('livekit:startGroupCall', {
        conversationId,
        roomName,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
      });
    } catch (err: any) {
      Alert.alert('Group Call Error', err.message || 'Could not start group call');
      await disconnectRoom();
    }
  }, [user, socket, fetchToken, connectGroupRoom, disconnectRoom]);

  // ── PUBLIC: join incoming group call ──────────────────────────────────────
  const joinGroupCall = useCallback(async () => {
    if (!incomingGroupCall) return;
    const { conversationId, callType } = incomingGroupCall;
    try {
      const { token, livekitUrl } = await fetchToken(conversationId);
      await connectGroupRoom(token, livekitUrl, callType);
      setGroupCallActive(true);
      setGroupCallType(callType);
      setActiveConvId(conversationId);
      setIncomingGroupCall(null);
    } catch (err: any) {
      Alert.alert('Group Call Error', err.message || 'Could not join group call');
      await disconnectRoom();
    }
  }, [incomingGroupCall, fetchToken, connectGroupRoom, disconnectRoom]);

  // ── PUBLIC: decline ────────────────────────────────────────────────────────
  const declineGroupCall = useCallback(() => {
    setIncomingGroupCall(null);
  }, []);

  // ── PUBLIC: leave ──────────────────────────────────────────────────────────
  const leaveGroupCall = useCallback(() => {
    if (socket && activeConvId) {
      socket.emit('livekit:endGroupCall', { conversationId: activeConvId, roomName: `group_${activeConvId}` });
    }
    disconnectRoom();
    setGroupCallActive(false);
    setActiveConvId('');
  }, [socket, activeConvId, disconnectRoom]);

  // ── Socket listeners ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (data: IncomingGroupCall) => {
      setIncomingGroupCall(data);
    };

    socket.on('livekit:incomingGroupCall', onIncoming);
    return () => { socket.off('livekit:incomingGroupCall', onIncoming); };
  }, [socket]);

  useEffect(() => () => { disconnectRoom(); }, []);

  return (
    <GroupCallContext.Provider value={{
      incomingGroupCall, groupCallActive, groupCallType,
      participants, room, activeConvId,
      startGroupCall, joinGroupCall, declineGroupCall, leaveGroupCall,
    }}>
      {children}
    </GroupCallContext.Provider>
  );
};

export const useGroupCall = () => {
  const ctx = useContext(GroupCallContext);
  if (!ctx) throw new Error('useGroupCall must be used within GroupCallProvider');
  return ctx;
};
