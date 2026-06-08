/**

 * LiveBroadcastContext — LiveKit room for mobile live streaming (camera + chat).

 */



import React, {

  createContext, useContext, useCallback, useEffect, useRef, useState, useMemo,

} from 'react';

import { Alert, AppState, DeviceEventEmitter } from 'react-native';

import {

  Room, RoomEvent, Track, LocalTrack, LocalVideoTrack, VideoPresets,
  facingModeFromLocalTrack, ConnectionState,

} from 'livekit-client';

import InCallManager from 'react-native-incall-manager';

import { useUser } from './UserContext';

import { useSocket } from './SocketContext';

import { API_URL, LIVE_BAR_RESIGN_GAME } from '../utils/constants';

import { startOngoingCallNative, stopOngoingCallNative, moveAppToBackgroundNative } from '../services/callData';

import { liveBroadcastNav } from '../services/liveBroadcastNav';
import { callSessionNav } from '../services/callSessionNav';
import { restoreCameraForViewers } from '../utils/liveBroadcastCamera';



/** End live if broadcaster leaves the app (home / swipe away) without Share app/phone minimize. */
const BROADCASTER_BACKGROUND_END_MS = 15000;



/** Mobile-first: lower encode + no simulcast layers. */

const LIVE_ROOM_OPTIONS = {

  adaptiveStream: true,

  dynacast: true,

  videoCaptureDefaults: {

    resolution: VideoPresets.h360.resolution,

  },

  publishDefaults: {

    simulcast: false,

    videoEncoding: { maxBitrate: 480_000, maxFramerate: 18 },

    screenShareEncoding: { maxBitrate: 420_000, maxFramerate: 8 },

  },

};



/** Lighter screen share — keeps mobile uplink stable with multiple viewers. */

const SCREEN_SHARE_CAPTURE = {

  audio: false,

  resolution: { width: 640, height: 360, frameRate: 8 },

};



const CAM_LIVE = VideoPresets.h360.resolution;

const CAM_SHARE_PIP = VideoPresets.h180.resolution;



interface LiveBroadcastContextType {

  isLive: boolean;

  viewerCount: number;

  startingLive: boolean;

  localTrack: LocalTrack | null;

  localScreenTrack: LocalTrack | null;

  isSharing: boolean;

  isMinimized: boolean;

  isLiveControlsFocused: boolean;

  /** Host face pip hidden with X while sharing (tap restore chip to show again). */
  hostPipVisible: boolean;

  showHostPip: () => void;

  hideHostPip: () => void;

  flipCamera: () => Promise<void>;

  goLive: () => Promise<void>;

  endLive: () => Promise<void>;

  /** End stream for viewers; stay on current screen (e.g. before answering a call). */
  endLiveForCall: () => Promise<void>;

  toggleShare: () => Promise<void>;

  /** Stop screen share only — never navigates away from live controls. */
  stopScreenShareOnly: () => Promise<void>;

  shareAndGoAppHome: () => Promise<void>;

  shareAndGoPhoneHome: () => Promise<void>;

  minimizeLive: () => void;

  returnToLiveControls: () => void;

  restoreLivePreview: () => Promise<void>;

  setLiveControlsFocused: (focused: boolean) => void;

  syncLocalTrack: () => void;

  getRoom: () => Room | null;

  sendChat: (text: string, senderName: string) => Promise<void>;

  liveRoomName: string;

  isMicMuted: boolean;

  toggleMicMute: () => Promise<void>;

}



const LiveBroadcastContext = createContext<LiveBroadcastContextType | undefined>(undefined);



export const LiveBroadcastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {

  const { user } = useUser();

  const socketCtx = useSocket();

  const socket = socketCtx?.socket;



  const [isLive, setIsLive] = useState(false);

  const [liveRoomName, setLiveRoomName] = useState('');

  const [isMicMuted, setIsMicMuted] = useState(false);

  const [viewerCount, setViewerCount] = useState(0);

  const [startingLive, setStartingLive] = useState(false);

  const [localTrack, setLocalTrack] = useState<LocalTrack | null>(null);

  const [localScreenTrack, setLocalScreenTrack] = useState<LocalTrack | null>(null);

  const [isSharing, setIsSharing] = useState(false);

  const [isMinimized, setIsMinimized] = useState(false);

  const [isLiveControlsFocused, setIsLiveControlsFocused] = useState(false);

  const [hostPipVisible, setHostPipVisible] = useState(true);



  const roomRef = useRef<Room | null>(null);

  const roomNameRef = useRef('');

  const liveEndedRef = useRef(false);

  const endLiveRef = useRef<() => Promise<void>>(async () => {});
  const teardownLiveRef = useRef<() => Promise<void>>(async () => {});
  const isMinimizedRef = useRef(false);

  const ongoingCallNativeStartedRef = useRef(false);

  const isSharingRef = useRef(false);

  /** Camera kept alive for host pip while unpublished during screen share. */
  const hostPreviewTrackRef = useRef<LocalTrack | null>(null);



  const syncLocalTrack = useCallback(() => {

    const room = roomRef.current;

    if (!room) {

      setLocalTrack(prev => (prev === null ? prev : null));

      setLocalScreenTrack(prev => (prev === null ? prev : null));

      setIsSharing(false);

      isSharingRef.current = false;

      hostPreviewTrackRef.current = null;

      return;

    }

    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera);

    const screenPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare);

    const screen = (screenPub?.track as LocalTrack) ?? null;

    const sharing = !!screen;

    const publishedCam = (camPub?.track as LocalTrack) ?? null;

    const cam = sharing

      ? (hostPreviewTrackRef.current ?? publishedCam)

      : publishedCam;

    setLocalTrack(prev => (prev === cam ? prev : cam));

    setLocalScreenTrack(prev => (prev === screen ? prev : screen));

    isSharingRef.current = sharing;

    setIsSharing(prev => (prev === sharing ? prev : sharing));

  }, []);



  const getRoom = useCallback(() => roomRef.current, []);

  const showHostPip = useCallback(() => setHostPipVisible(true), []);

  const hideHostPip = useCallback(() => setHostPipVisible(false), []);

  const flipCamera = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;

    const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
    let track = (pub?.track ?? hostPreviewTrackRef.current) as LocalTrack | null | undefined;
    if (!track || track.kind !== Track.Kind.Video) return;

    const video = track as LocalVideoTrack;
    if (typeof video.restartTrack !== 'function') return;

    try {
      const { facingMode: current } = facingModeFromLocalTrack(video);
      const next: 'user' | 'environment' =
        current === 'environment' ? 'user' : 'environment';
      await video.restartTrack({ facingMode: next });
      syncLocalTrack();
    } catch (e) {
      console.warn('[LiveBroadcast] flip camera failed:', e);
    }
  }, [syncLocalTrack]);

  const stopAllPublishedTracks = useCallback(async () => {

    const room = roomRef.current;

    if (!room) return;

    try { await room.localParticipant.setScreenShareEnabled(false); } catch (_) {}

    try { await room.localParticipant.setCameraEnabled(false); } catch (_) {}

    try { await room.localParticipant.setMicrophoneEnabled(false); } catch (_) {}

    isSharingRef.current = false;

    setIsSharing(false);

  }, []);



  const disconnect = useCallback(async () => {

    await stopAllPublishedTracks();

    try { stopOngoingCallNative(); } catch (_) {}

    if (
      !callSessionNav.isInOneToOneCallSession
      && !callSessionNav.isOnCallScreen
      && !callSessionNav.isOnGroupCallScreen
    ) {
      try { InCallManager.stop(); } catch (_) {}
    }

    try { await roomRef.current?.disconnect(); } catch (_) {}

    roomRef.current = null;

    setLocalTrack(null);

    setLocalScreenTrack(null);

    setIsSharing(false);

    isSharingRef.current = false;

    hostPreviewTrackRef.current = null;

    setHostPipVisible(true);

    setIsMinimized(false);

    setIsLiveControlsFocused(false);

    setViewerCount(0);

    ongoingCallNativeStartedRef.current = false;

  }, [stopAllPublishedTracks]);



  const stashPreviewForShare = useCallback(async (room: Room) => {

    let pub = room.localParticipant.getTrackPublication(Track.Source.Camera);

    if (!pub?.track) {

      await room.localParticipant.setCameraEnabled(true, { resolution: CAM_SHARE_PIP });

      pub = room.localParticipant.getTrackPublication(Track.Source.Camera);

    }

    const track = (pub?.track as LocalTrack) ?? null;

    if (track) {
      hostPreviewTrackRef.current = track;
      setLocalTrack(track);
    }

    if (track) await room.localParticipant.unpublishTrack(track, false);

  }, []);



  const restoreLivePreview = useCallback(async () => {

    const room = roomRef.current;

    if (!room || !isLive || !isLiveControlsFocused) return;

    try {

      if (isSharingRef.current) {

        await stashPreviewForShare(room);

      } else {

        await restoreCameraForViewers(room, hostPreviewTrackRef.current);

        hostPreviewTrackRef.current = null;

      }

    } catch (_) {}

    syncLocalTrack();

  }, [isLive, isLiveControlsFocused, syncLocalTrack, stashPreviewForShare]);



  const ensureScreenShare = useCallback(async () => {

    const room = roomRef.current;

    if (!room || isSharingRef.current) return true;

    try {

      await room.localParticipant.setScreenShareEnabled(true, SCREEN_SHARE_CAPTURE);

      await stashPreviewForShare(room);

      isSharingRef.current = true;

      setIsSharing(true);

      syncLocalTrack();

      return true;

    } catch (err: any) {

      const msg = err?.message || String(err);

      if (!/cancel|denied|abort/i.test(msg)) {

        Alert.alert('Screen share', `Could not start screen sharing.\n\n${msg}`);

      }

      return false;

    }

  }, [syncLocalTrack, stashPreviewForShare]);



  const minimizeLive = useCallback(() => {

    setIsMinimized(true);
    isMinimizedRef.current = true;

    setIsLiveControlsFocused(false);

    liveBroadcastNav.minimize?.();

  }, []);



  const returnToLiveControls = useCallback(() => {

    setIsMinimized(false);
    isMinimizedRef.current = false;

    setIsLiveControlsFocused(true);

    liveBroadcastNav.setFloatingTouchesBlocked(false);

    void restoreLivePreview();

  }, [restoreLivePreview]);



  const setLiveControlsFocused = useCallback((focused: boolean) => {

    setIsLiveControlsFocused(focused);

    if (focused) {

      setIsMinimized(false);
      isMinimizedRef.current = false;

      liveBroadcastNav.setFloatingTouchesBlocked(false);

      void restoreLivePreview();

    }

  }, [restoreLivePreview]);



  const shareAndGoAppHome = useCallback(async () => {

    if (!roomRef.current || !isLive) return;

    if (isSharingRef.current) return;

    const ok = await ensureScreenShare();

    if (ok) minimizeLive();

  }, [isLive, ensureScreenShare, minimizeLive]);



  const shareAndGoPhoneHome = useCallback(async () => {

    if (!roomRef.current || !isLive) return;

    if (isSharingRef.current) return;

    const ok = await ensureScreenShare();

    if (!ok) return;

    setIsMinimized(true);
    isMinimizedRef.current = true;

    setIsLiveControlsFocused(false);

    await moveAppToBackgroundNative();

  }, [isLive, ensureScreenShare]);



  const toggleShare = useCallback(async () => {

    const room = roomRef.current;

    if (!room || !isLive) return;

    const next = !isSharingRef.current;

    try {

      if (next) {

        await room.localParticipant.setScreenShareEnabled(true, SCREEN_SHARE_CAPTURE);

        await stashPreviewForShare(room);

      } else {

        await room.localParticipant.setScreenShareEnabled(false);

        const preview = hostPreviewTrackRef.current;

        await restoreCameraForViewers(room, preview);

        hostPreviewTrackRef.current = null;

        if (!room.localParticipant.getTrackPublication(Track.Source.Camera)?.track) {

          await room.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });

        }

      }

      isSharingRef.current = next;

      setIsSharing(next);

      if (!next) setHostPipVisible(true);

      syncLocalTrack();

    } catch (err: any) {

      const msg = err?.message || String(err);

      console.warn('[LiveBroadcast] screen share failed:', msg);

      isSharingRef.current = false;

      setIsSharing(false);

      setHostPipVisible(true);

      if (next && !/cancel|denied|abort/i.test(msg)) {

        Alert.alert('Screen share', `Could not start screen sharing.\n\n${msg}`);

      }

    }

  }, [isLive, syncLocalTrack, stashPreviewForShare]);



  const stopScreenShareOnly = useCallback(async () => {

    const room = roomRef.current;

    if (!room || !isLive || !isSharingRef.current) return;

    try {

      await room.localParticipant.setScreenShareEnabled(false);

      const preview = hostPreviewTrackRef.current;

      await restoreCameraForViewers(room, preview);

      hostPreviewTrackRef.current = null;

      if (!room.localParticipant.getTrackPublication(Track.Source.Camera)?.track) {

        await room.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });

      }

      isSharingRef.current = false;

      setIsSharing(false);

      setHostPipVisible(true);

      syncLocalTrack();

    } catch (err: any) {

      console.warn('[LiveBroadcast] stop screen share failed:', err?.message || err);

      isSharingRef.current = false;

      setIsSharing(false);

      setHostPipVisible(true);

      syncLocalTrack();

    }

  }, [isLive, syncLocalTrack]);



  const teardownLiveSession = useCallback(async () => {
    if (!roomRef.current && !isLive) return;

    liveBroadcastNav.suppressGameCleanupNav = true;
    setIsLive(false);
    setIsMinimized(false);
    isMinimizedRef.current = false;
    setIsLiveControlsFocused(false);
    DeviceEventEmitter.emit(LIVE_BAR_RESIGN_GAME, { leaveGameScreen: false });

    if (socket && user?._id) {
      socket.emit('livekit:leaveLiveWatch', { streamerId: String(user._id) });
      if (roomNameRef.current && !liveEndedRef.current) {
        liveEndedRef.current = true;
        socket.emit('livekit:endLive', {
          streamerId: String(user._id),
          roomName: roomNameRef.current,
        });
      }
    }

    roomNameRef.current = '';
    setLiveRoomName('');
    setIsMicMuted(false);
    await disconnect();

    setTimeout(() => {
      liveBroadcastNav.suppressGameCleanupNav = false;
    }, 2000);
  }, [socket, user, disconnect, isLive]);

  const endLiveForCall = useCallback(async () => {
    await teardownLiveSession();
  }, [teardownLiveSession]);

  const endLive = useCallback(async () => {
    // Navigate to the profile FIRST so the live UI (and its "Go Live" button)
    // disappears immediately. The room teardown below does `await disconnect()`
    // which takes 2-3s; if we navigated after it, the live screen stayed visible
    // during that window and tapping "Go Live" again started a new stream that
    // then got yanked to the profile. Leaving the live screen up front avoids it.
    liveBroadcastNav.goToProfile?.();
    await teardownLiveSession();
  }, [teardownLiveSession]);

  useEffect(() => {
    liveBroadcastNav.endForCall = endLiveForCall;
    return () => {
      liveBroadcastNav.endForCall = null;
    };
  }, [endLiveForCall]);

  endLiveRef.current = endLive;
  teardownLiveRef.current = teardownLiveSession;

  useEffect(() => {
    isMinimizedRef.current = isMinimized;
  }, [isMinimized]);

  /** Home / swipe-away without intentional minimize — end live after 15s so feed does not stay "Live now". */
  useEffect(() => {
    if (!isLive) return undefined;

    let backgroundTimer: ReturnType<typeof setTimeout> | null = null;

    const clearBackgroundTimer = () => {
      if (backgroundTimer) {
        clearTimeout(backgroundTimer);
        backgroundTimer = null;
      }
    };

    const scheduleBackgroundEnd = () => {
      clearBackgroundTimer();
      if (
        isMinimizedRef.current
        || isSharingRef.current
        || callSessionNav.isInOneToOneCallSession
        || callSessionNav.isOnCallScreen
        || callSessionNav.isOnGroupCallScreen
      ) return;
      backgroundTimer = setTimeout(() => {
        backgroundTimer = null;
        if (liveEndedRef.current) return;
        if (isMinimizedRef.current || isSharingRef.current) return;
        console.warn('[LiveBroadcast] App left >15s without minimize — ending live');
        void teardownLiveRef.current?.();
      }, BROADCASTER_BACKGROUND_END_MS);
    };

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        clearBackgroundTimer();
        return;
      }
      if (next === 'background' || next === 'inactive') {
        scheduleBackgroundEnd();
      }
    });

    return () => {
      sub.remove();
      clearBackgroundTimer();
    };
  }, [isLive]);

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

      setLiveRoomName(roomName || '');

      setIsMicMuted(false);

      liveEndedRef.current = false;



      const lkRoom = new Room(LIVE_ROOM_OPTIONS);

      roomRef.current = lkRoom;



      lkRoom.on(RoomEvent.ParticipantConnected, () => setViewerCount(c => c + 1));

      lkRoom.on(RoomEvent.ParticipantDisconnected, () => setViewerCount(c => Math.max(0, c - 1)));

      lkRoom.on(RoomEvent.Reconnecting, () => {
        console.warn('[LiveBroadcast] LiveKit reconnecting…');
      });

      lkRoom.on(RoomEvent.Reconnected, () => {
        syncLocalTrack();
      });

      lkRoom.on(RoomEvent.Disconnected, () => {

        if (!liveEndedRef.current) {
          console.warn('[LiveBroadcast] LiveKit disconnected — cleaning up live session');
          void teardownLiveRef.current?.();
          return;
        }

        roomRef.current = null;

        setLocalTrack(null);

        setLocalScreenTrack(null);

        setIsSharing(false);

        isSharingRef.current = false;

        setIsLive(false);

      });

      const onLocalTracks = () => syncLocalTrack();

      lkRoom.on(RoomEvent.LocalTrackPublished, onLocalTracks);

      lkRoom.on(RoomEvent.LocalTrackUnpublished, onLocalTracks);



      await lkRoom.connect(livekitUrl, token);



      try {

        InCallManager.start({ media: 'video', auto: false, ringback: '' });

        InCallManager.setForceSpeakerphoneOn(true);

      } catch (_) {}



      await lkRoom.localParticipant.setMicrophoneEnabled(true);

      await lkRoom.localParticipant.setCameraEnabled(true, { resolution: CAM_LIVE });

      syncLocalTrack();



      try {

        if (!ongoingCallNativeStartedRef.current) {

          ongoingCallNativeStartedRef.current = true;

          startOngoingCallNative(user.name || user.username || 'Live', true);

        }

      } catch (_) {}



      setIsLive(true);

      socket.emit('livekit:joinLiveWatch', { streamerId: String(user._id) });

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

  const toggleMicMute = useCallback(async () => {
    const room = roomRef.current;
    if (!room || !isLive) return;
    const next = !isMicMuted;
    try {
      await room.localParticipant.setMicrophoneEnabled(!next);
      setIsMicMuted(next);
    } catch (_) {}
  }, [isLive, isMicMuted]);



  useEffect(() => {

    if (!socket || !isLive || !user?._id) return;

    const onStreamEnded = async (payload: any) => {

      if (String(payload?.streamerId || '') !== String(user._id)) return;

      const room = roomRef.current;

      if (
        room
        && (room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting)
      ) {
        console.warn('[LiveBroadcast] Ignoring streamEnded — LiveKit session still active');
        return;
      }

      if (liveEndedRef.current) return;

      // Teardown only — never navigate to profile (would kill an active call).
      await teardownLiveRef.current?.();

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

    localScreenTrack,

    isSharing,

    isMinimized,

    isLiveControlsFocused,

    hostPipVisible,

    showHostPip,

    hideHostPip,

    flipCamera,

    goLive,

    endLive,

    endLiveForCall,

    toggleShare,

    stopScreenShareOnly,

    shareAndGoAppHome,

    shareAndGoPhoneHome,

    minimizeLive,

    returnToLiveControls,

    restoreLivePreview,

    setLiveControlsFocused,

    syncLocalTrack,

    getRoom,

    sendChat,

    liveRoomName,

    isMicMuted,

    toggleMicMute,

  }), [

    isLive, viewerCount, startingLive, localTrack, localScreenTrack, isSharing,

    isMinimized, isLiveControlsFocused, hostPipVisible,

    showHostPip, hideHostPip, flipCamera,

    goLive, endLive, endLiveForCall, toggleShare, stopScreenShareOnly, shareAndGoAppHome, shareAndGoPhoneHome,

    minimizeLive, returnToLiveControls, restoreLivePreview, setLiveControlsFocused,

    syncLocalTrack, getRoom, sendChat, liveRoomName, isMicMuted, toggleMicMute,

  ]);



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


