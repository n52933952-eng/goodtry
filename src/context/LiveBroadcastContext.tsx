/**
 * LiveBroadcastContext — LiveKit room for mobile live streaming (camera + chat).
 */

import React, {
  createContext, useContext, useCallback, useEffect, useRef, useState, useMemo,
} from 'react';
import { Alert, DeviceEventEmitter } from 'react-native';
import { Room, RoomEvent, Track, LocalTrack } from 'livekit-client';
import InCallManager from 'react-native-incall-manager';
import { useUser } from './UserContext';
import { useSocket } from './SocketContext';
import { API_URL, LIVE_BAR_RESIGN_GAME } from '../utils/constants';
import { startOngoingCallNative, stopOngoingCallNative } from '../services/callData';

const LIVESTREAM_MAX_MS = 25 * 60 * 1000;
const LIVESTREAM_AUTO_END_BEFORE_MS = 90 * 1000;

interface LiveBroadcastContextType {
  isLive: boolean;
  viewerCount: number;
  startingLive: boolean;
  localTrack: LocalTrack | null;
  goLive: () => Promise<void>;
  endLive: () => Promise<void>;
  syncLocalTrack: () => void;
  getRoom: () => Room | null;
  sendChat: (text: string, senderName: string) => Promise<void>;
}

const LiveBroadcastContext = createContext<LiveBroadcastContextType | undefined>(undefined);

export const LiveBroadcastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useUser();
  const socketCtx = useSocket();
  const socket = socketCtx?.socket;

  const [isLive, setIsLive] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [startingLive, setStartingLive] = useState(false);
  const [localTrack, setLocalTrack] = useState<LocalTrack | null>(null);

  const roomRef = useRef<Room | null>(null);
  const roomNameRef = useRef('');
  const endLiveRef = useRef<() => Promise<void>>(async () => {});
  const ongoingCallNativeStartedRef = useRef(false);

  const syncLocalTrack = useCallback(() => {
    const room = roomRef.current;
    if (!room) {
      setLocalTrack(prev => (prev === null ? prev : null));
      return;
    }
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    const next = (camPub?.track as LocalTrack) ?? null;
    setLocalTrack(prev => (prev === next ? prev : next));
  }, []);

  const getRoom = useCallback(() => roomRef.current, []);

  const disconnect = useCallback(async () => {
    try { stopOngoingCallNative(); } catch (_) {}
    try { InCallManager.stop(); } catch (_) {}
    try { await roomRef.current?.disconnect(); } catch (_) {}
    roomRef.current = null;
    setLocalTrack(null);
    setViewerCount(0);
    ongoingCallNativeStartedRef.current = false;
  }, []);

  const endLive = useCallback(async () => {
    DeviceEventEmitter.emit(LIVE_BAR_RESIGN_GAME);
    if (socket && user?._id && roomNameRef.current) {
      socket.emit('livekit:endLive', {
        streamerId: String(user._id),
        roomName: roomNameRef.current,
      });
    }
    roomNameRef.current = '';
    await disconnect();
    setIsLive(false);
  }, [socket, user, disconnect]);

  endLiveRef.current = endLive;

  const goLive = useCallback(async () => {
    if (!user || !socket || startingLive) return;
    if (roomRef.current && isLive) {
      syncLocalTrack();
      return;
    }

    setStartingLive(true);
    try {
      const res = await fetch(`${API_URL}/api/call/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ type: 'livestream', targetId: String(user._id) }),
      });
      if (!res.ok) {
        Alert.alert('Go Live failed', 'Could not connect to the live server.');
        return;
      }
      const { token, roomName, livekitUrl } = await res.json();
      roomNameRef.current = roomName;

      const lkRoom = new Room();
      roomRef.current = lkRoom;

      lkRoom.on(RoomEvent.ParticipantConnected, () => setViewerCount(c => c + 1));
      lkRoom.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));
      lkRoom.on(RoomEvent.Disconnected, () => {
        roomRef.current = null;
        setLocalTrack(null);
        setIsLive(false);
      });

      await lkRoom.connect(livekitUrl, token);

      try {
        InCallManager.start({ media: 'video', auto: false, ringback: '' });
        InCallManager.setForceSpeakerphoneOn(true);
      } catch (_) {}

      await lkRoom.localParticipant.setMicrophoneEnabled(true);
      await lkRoom.localParticipant.setCameraEnabled(true);
      syncLocalTrack();

      try {
        if (!ongoingCallNativeStartedRef.current) {
          ongoingCallNativeStartedRef.current = true;
          startOngoingCallNative(user.name || user.username || 'Live', true);
        }
      } catch (_) {}

      setIsLive(true);
      socket.emit('livekit:goLive', {
        streamerId: String(user._id),
        streamerName: user.name || user.username,
        streamerProfilePic: user.profilePic,
        roomName,
      });
    } catch (err) {
      console.error('[LiveBroadcast] goLive:', err);
    } finally {
      setStartingLive(false);
    }
  }, [user, socket, startingLive, isLive, syncLocalTrack]);

  const sendChat = useCallback(async (text: string, senderName: string) => {
    const trimmed = text.trim();
    const room = roomRef.current;
    if (!trimmed || !room) return;
    const msg = { type: 'chat', sender: senderName, text: trimmed };
    const encoded = new TextEncoder().encode(JSON.stringify(msg));
    await room.localParticipant.publishData(encoded, { reliable: true });
  }, []);

  useEffect(() => {
    if (!isLive) return;
    const ms = Math.max(60_000, LIVESTREAM_MAX_MS - LIVESTREAM_AUTO_END_BEFORE_MS);
    const t = setTimeout(() => {
      Alert.alert('Live session limit', 'Your broadcast reached the maximum session length.');
      void endLiveRef.current?.();
    }, ms);
    return () => clearTimeout(t);
  }, [isLive]);

  useEffect(() => {
    if (!socket || !isLive || !user?._id) return;
    const onStreamEnded = async (payload: any) => {
      if (String(payload?.streamerId || '') !== String(user._id)) return;
      await endLiveRef.current?.();
    };
    socket.on('livekit:streamEnded', onStreamEnded);
    return () => { socket.off('livekit:streamEnded', onStreamEnded); };
  }, [socket, isLive, user?._id]);

  useEffect(() => {
    if (!user && isLive) void endLiveRef.current?.();
  }, [user, isLive]);

  const value = useMemo<LiveBroadcastContextType>(() => ({
    isLive,
    viewerCount,
    startingLive,
    localTrack,
    goLive,
    endLive,
    syncLocalTrack,
    getRoom,
    sendChat,
  }), [isLive, viewerCount, startingLive, localTrack, goLive, endLive, syncLocalTrack, getRoom, sendChat]);

  return (
    <LiveBroadcastContext.Provider value={value}>
      {children}
    </LiveBroadcastContext.Provider>
  );
};

export const useLiveBroadcast = () => {
  const ctx = useContext(LiveBroadcastContext);
  if (!ctx) throw new Error('useLiveBroadcast must be used within LiveBroadcastProvider');
  return ctx;
};
