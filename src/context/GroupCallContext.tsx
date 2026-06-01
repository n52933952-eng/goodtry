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
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
} from 'livekit-client';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import { API_URL } from '../utils/constants';
import { startOngoingCallNative, stopOngoingCallNative } from '../services/callData';
import { callSessionNav } from '../services/callSessionNav';

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
  /** Same as `room` but from ref — reliable for mute/camera while state catches up. */
  getGroupCallRoom:  () => Room | null;
  activeConvId:      string;
  /** True when *I* am sharing my screen in this group call. */
  isScreenSharing:   boolean;
  /** Start/stop sharing my screen (Google Meet style; triggers Android capture-permission dialog). */
  toggleScreenShare: () => Promise<void>;
  startGroupCall:    (conversationId: string, type?: 'audio' | 'video') => Promise<void>;
  joinGroupCall:     () => Promise<void>;
  declineGroupCall:  () => void;
  leaveGroupCall:    () => void;
  /** User left GroupCallScreen but call is still active. */
  isGroupCallUIMinimized: boolean;
  minimizeGroupCallUI: () => void;
  openGroupCallUI: () => void;
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
  const [isScreenSharing,   setIsScreenSharing]   = useState(false);
  const [isGroupCallUIMinimized, setIsGroupCallUIMinimized] = useState(false);
  const roomRef = useRef<Room | null>(null);
  const isScreenSharingRef = useRef(false);

  const getGroupCallRoom = useCallback(() => roomRef.current, []);

  // ── screen sharing (Google Meet style) ──────────────────────────────────────
  const toggleScreenShare = useCallback(async () => {
    const lk = roomRef.current;
    if (!lk) return;
    const next = !isScreenSharingRef.current;
    try {
      await lk.localParticipant.setScreenShareEnabled(next);
      isScreenSharingRef.current = next;
      setIsScreenSharing(next);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('⚠️ [GroupCall] screen share toggle failed:', msg);
      isScreenSharingRef.current = false;
      setIsScreenSharing(false);
      if (next && !/cancel|denied|abort/i.test(msg)) {
        Alert.alert('Screen share', `Could not start screen sharing.\n\n${msg}`);
      }
    }
  }, []);

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
    isScreenSharingRef.current = false;
    setIsScreenSharing(false);
    stopOngoingCallNative();
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
    // Keep the group call alive while backgrounded; ends on swipe-away (OngoingCallService).
    startOngoingCallNative('Group call', type !== 'audio');
    await lkRoom.localParticipant.setMicrophoneEnabled(true);
    if (type !== 'audio') await lkRoom.localParticipant.setCameraEnabled(true);
    refresh();
  }, [disconnectRoom]);

  // ── PUBLIC: start group call ───────────────────────────────────────────────
  const startGroupCall = useCallback(async (conversationId: string, type: 'audio' | 'video' = 'video') => {
    if (!user || !socket) return;
    try {
      const { token, roomName, livekitUrl } = await fetchToken(conversationId);

      // Notify participants before heavy local connect so invites are not delayed by camera init.
      socket.emit('livekit:startGroupCall', {
        conversationId,
        roomName,
        callerName:       user.name || user.username,
        callerProfilePic: user.profilePic,
        callType:         type,
      });

      await connectGroupRoom(token, livekitUrl, type);
      setGroupCallActive(true);
      setGroupCallType(type);
      setActiveConvId(conversationId);
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
  // Only disconnect locally from LiveKit. Do NOT emit `livekit:endGroupCall` — that event tells
  // the server to broadcast `groupCallEnded` to everyone, which kicked all participants when one left.
  const leaveGroupCall = useCallback(() => {
    void (async () => {
      await disconnectRoom();
      setGroupCallActive(false);
      setActiveConvId('');
      setIsGroupCallUIMinimized(false);
    })();
  }, [disconnectRoom]);

  const minimizeGroupCallUI = useCallback(() => {
    if (!groupCallActive) return;
    setIsGroupCallUIMinimized(true);
    callSessionNav.minimizeToAppHome?.();
  }, [groupCallActive]);

  const openGroupCallUI = useCallback(() => {
    setIsGroupCallUIMinimized(false);
  }, []);

  // ── Socket listeners ───────────────────────────────────────────────────────
  // Re-bind on every new Socket.IO instance (reconnect / replace). Otherwise listeners stay on the
  // dead socket and mobile↔mobile group invites never arrive after backgrounding or network flap.
  useEffect(() => {
    if (!socket) return;

    const onIncoming = (data: IncomingGroupCall) => {
      setIncomingGroupCall(data);
    };
    const onGroupEnded = (payload: any) => {
      const endedConvId = String(payload?.conversationId || '');
      if (!endedConvId) return;
      const isRelevantIncoming = incomingGroupCall?.conversationId === endedConvId;
      const isRelevantActive = activeConvId === endedConvId;
      if (!isRelevantIncoming && !isRelevantActive) return;

      setIncomingGroupCall(null);
      setGroupCallActive(false);
      setActiveConvId('');
      void disconnectRoom();

      if (payload?.reason === 'timeout') {
        Alert.alert('Group call ended', 'This group call reached the 25-minute limit.');
      }
    };

    const onMembersBusy = ({ busyCount, totalOther }: { busyCount: number; totalOther: number }) => {
      if (!busyCount) return;
      const all = busyCount >= totalOther;
      Alert.alert(
        all ? 'All members are busy' : `${busyCount} member${busyCount > 1 ? 's' : ''} couldn't be reached`,
        all
          ? 'Everyone in this group is currently in a call or playing a game.'
          : `${busyCount} member${busyCount > 1 ? 's are' : ' is'} busy (in a call or game) and won't receive the call.`,
      );
    };

    const bind = () => {
      try {
        socket.off('livekit:incomingGroupCall',  onIncoming);
        socket.off('livekit:groupCallEnded',     onGroupEnded);
        socket.off('livekit:groupMembersBusy',   onMembersBusy);
      } catch (_) {
        /* ignore */
      }
      socket.on('livekit:incomingGroupCall',  onIncoming);
      socket.on('livekit:groupCallEnded',     onGroupEnded);
      socket.on('livekit:groupMembersBusy',   onMembersBusy);
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
      socket.off('livekit:incomingGroupCall',  onIncoming);
      socket.off('livekit:groupCallEnded',     onGroupEnded);
      socket.off('livekit:groupMembersBusy',   onMembersBusy);
    };
  }, [socket, incomingGroupCall?.conversationId, activeConvId, disconnectRoom]);

  useEffect(() => () => { disconnectRoom(); }, []);

  return (
    <GroupCallContext.Provider value={{
      incomingGroupCall, groupCallActive, groupCallType,
      participants, room, getGroupCallRoom, activeConvId,
      isScreenSharing, toggleScreenShare,
      startGroupCall, joinGroupCall, declineGroupCall, leaveGroupCall,
      isGroupCallUIMinimized, minimizeGroupCallUI, openGroupCallUI,
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
