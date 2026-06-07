/**
 * LiveViewerScreen — watch a live stream on mobile (fullscreen like broadcaster).
 */

import React, {
  useEffect, useRef, useState, useCallback, useMemo,
} from 'react';
import {
  View, Text, TouchableOpacity, Pressable, StyleSheet, TextInput,
  Platform, Image, Animated, Keyboard, Easing, ActivityIndicator,
  FlatList, useWindowDimensions,
} from 'react-native';
import { VideoView } from '@livekit/react-native';
import { Room, RoomEvent, Track, RemoteAudioTrack, ConnectionState } from 'livekit-client';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useTheme } from '../../context/ThemeContext';
import InCallManager from 'react-native-incall-manager';
import { API_URL } from '../../utils/constants';
import ScreenShareViewer from '../../components/ScreenShareViewer';
import LiveShareModal from '../../components/LiveShareModal';
import {
  isScreenSharePublication,
  isVideoPublication,
  collectRemoteVideoTracks,
  applyRemoteVideoTrack,
} from '../../utils/liveKitTracks';
import { liveActionStyles, s, useLiveScreenMetrics } from '../../utils/liveScreenLayout';

interface FloatMsg { id: string; sender: string; text: string; anim: Animated.Value; opacity: Animated.Value }
interface FloatReaction {
  id: string;
  emoji: string;
  driftX: number;
  anim: Animated.Value;
  opacity: Animated.Value;
  scale: Animated.Value;
}

const ACTION_RAIL_SLOTS = 5;
const LIVE_EMOJIS = ['❤️', '😂', '🔥', '👏', '😍', '🎉', '💯', '🙌'];
const EMOJI_FLOAT_UP = 300;
const EMOJI_FLOAT_MS = 2800;
const EMOJI_PICKER_SPRING = { friction: 9, tension: 88, useNativeDriver: true as const };
const CHAT_PANEL_BG = 'rgba(20, 48, 82, 0.88)';
const CHAT_PANEL_BORDER = 'rgba(96, 165, 250, 0.4)';
const FLOAT_DRIFT_UP = 220;
const FLOAT_DRIFT_MS = 7000;
const FLOAT_FADE_DELAY_MS = 4400;
const FLOAT_FADE_MS = 2000;
const SPRING_CFG = { friction: 11, tension: 78, useNativeDriver: false as const };
const UI_TIMING = { duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true as const };
const FloatingReaction = ({
  reaction,
  emojiStyle,
}: {
  reaction: FloatReaction;
  emojiStyle?: object;
}) => (
  <Animated.View
    style={[
      styles.floatReaction,
      {
        transform: [
          { translateY: reaction.anim },
          { translateX: reaction.driftX },
          { scale: reaction.scale },
        ],
        opacity: reaction.opacity,
      },
    ]}
    pointerEvents="none"
  >
    <Text style={[styles.floatReactionEmoji, emojiStyle]}>{reaction.emoji}</Text>
  </Animated.View>
);

const FloatingBubble = ({ msg }: { msg: FloatMsg }) => (
  <Animated.View
    style={[
      styles.floatBubble,
      {
        transform: [{ translateY: msg.anim }],
        opacity: msg.opacity,
      },
    ]}
    pointerEvents="none"
  >
    <Text style={styles.floatSender}>{msg.sender}: </Text>
    <Text style={styles.floatText}>{msg.text}</Text>
  </Animated.View>
);

/** Fit = letterbox inset; Fill = edge-to-edge inner frame. */
const FitFillIcon = ({ filled, active }: { filled: boolean; active?: boolean }) => (
  <View style={styles.fitFillIconWrap}>
    <View style={[styles.fitFillOuter, active && styles.fitFillOuterActive]}>
      <View style={[styles.fitFillInner, filled ? styles.fitFillInnerFull : styles.fitFillInnerFit]} />
    </View>
  </View>
);

const ReactHeartIcon = ({ active }: { active?: boolean }) => (
  <Text style={[styles.reactHeartIcon, active && styles.reactHeartIconOn]}>♥</Text>
);

const LiveActionButton = ({
  icon,
  iconNode,
  label,
  onPress,
  circleStyle,
  ui,
}: {
  icon?: string;
  iconNode?: React.ReactNode;
  label: string;
  onPress: () => void;
  circleStyle?: object;
  ui?: ReturnType<typeof liveActionStyles>;
}) => (
  <TouchableOpacity style={styles.actionItem} onPress={onPress} activeOpacity={0.85}>
    <View style={[styles.actionCircle, ui?.actionCircle, circleStyle]}>
      {iconNode || <Text style={[styles.actionIcon, ui?.actionIcon]}>{icon}</Text>}
    </View>
    <Text style={[styles.actionLabel, ui?.actionLabel]}>{label}</Text>
  </TouchableOpacity>
);

const LiveViewerScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { user } = useUser();
  const socketCtx = useSocket();
  const socket = socketCtx?.socket;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: winW, height: winH } = useWindowDimensions();
  const metrics = useLiveScreenMetrics();
  const ui = useMemo(() => liveActionStyles(metrics, ACTION_RAIL_SLOTS), [metrics]);

  const {
    streamerId,
    streamerName,
    streamerProfilePic,
    roomName,
    returnToChat,
  } = route.params || {};

  const bottomPad = Math.max(insets.bottom, 10);
  const actionRailBottom = bottomPad + metrics.viewerRailBottomExtra;
  const chatAboveInputBottom = bottomPad + metrics.pillH + s(18, metrics.scale);

  const [remoteScreenTrack, setRemoteScreenTrack] = useState<any>(null);
  const [remoteCameraTrack, setRemoteCameraTrack] = useState<any>(null);
  const [screenRenderKey, setScreenRenderKey] = useState(0);
  const [isConnected, setIsConnected] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  /** false = fit (full body, letterbox); true = fill (edge-to-edge fullscreen). */
  const [videoFitCover, setVideoFitCover] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatLog, setChatLog] = useState<{ id: string; sender: string; text: string }[]>([]);
  const [floatMsgs, setFloatMsgs] = useState<FloatMsg[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [floatReactions, setFloatReactions] = useState<FloatReaction[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const emojiPanelAnim = useRef(new Animated.Value(0)).current;
  const railBottomAnim = useRef(new Animated.Value(actionRailBottom)).current;
  const inputBottomAnim = useRef(new Animated.Value(0)).current;
  const logBottomAnim = useRef(new Animated.Value(chatAboveInputBottom + 6)).current;
  const logHeightAnim = useRef(new Animated.Value(metrics.chatLogH)).current;
  const floatOpacityAnim = useRef(new Animated.Value(1)).current;
  const railOpacityAnim = useRef(new Animated.Value(1)).current;
  const railSlideAnim = useRef(new Animated.Value(0)).current;

  const roomRef = useRef<Room | null>(null);
  const isMutedRef = useRef(false);
  const intentionalLeaveRef = useRef(false);
  const closingRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatRef = useRef<FlatList>(null);
  const chatInputRef = useRef<TextInput>(null);
  const msgCounter = useRef(0);
  const removeTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const MAX_VIEWER_RECONNECT = 2;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: { endCoordinates: { height: number } }) => {
      setKeyboardHeight(e.endCoordinates.height);
      setEmojiPickerOpen(false);
      emojiPanelAnim.setValue(0);
    };
    const onHide = () => setKeyboardHeight(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [emojiPanelAnim]);

  useEffect(() => {
    if (keyboardHeight === 0) {
      railBottomAnim.setValue(actionRailBottom);
    }
  }, [actionRailBottom, keyboardHeight, railBottomAnim]);

  useEffect(() => {
    const open = keyboardHeight > 0;
    const stackH = metrics.pillH + s(10, metrics.scale) + (open ? 8 : bottomPad);
    const railTarget = open ? keyboardHeight + stackH + s(14, metrics.scale) : actionRailBottom;
    const logTarget = (open ? keyboardHeight : 0) + stackH + 6;
    const logH = open ? metrics.keyboardLogH : metrics.chatLogH;
    Animated.parallel([
      Animated.spring(inputBottomAnim, { toValue: keyboardHeight, ...SPRING_CFG }),
      Animated.spring(railBottomAnim, { toValue: railTarget, ...SPRING_CFG }),
      Animated.spring(logBottomAnim, { toValue: logTarget, ...SPRING_CFG }),
      Animated.spring(logHeightAnim, { toValue: logH, ...SPRING_CFG }),
      Animated.timing(floatOpacityAnim, { toValue: open ? 0 : 1, ...UI_TIMING }),
      Animated.timing(railOpacityAnim, { toValue: open ? 0.9 : 1, ...UI_TIMING }),
      Animated.spring(railSlideAnim, {
        toValue: open ? 8 : 0,
        friction: 12,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, [
    keyboardHeight, actionRailBottom, bottomPad, chatAboveInputBottom, metrics,
    railBottomAnim, inputBottomAnim, logBottomAnim, logHeightAnim,
    floatOpacityAnim, railOpacityAnim, railSlideAnim,
  ]);

  const verifyStreamStillActive = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(
        `${API_URL}/api/call/livestream/${encodeURIComponent(String(streamerId))}/status`,
        { credentials: 'include' },
      );
      if (!res.ok) return true;
      const st = await res.json().catch(() => ({}));
      return st?.active !== false;
    } catch {
      return true;
    }
  }, [streamerId]);

  const leaveLive = useCallback(() => {
    intentionalLeaveRef.current = true;
    closingRef.current = true;
    if (socket && streamerId) {
      socket.emit('livekit:leaveLiveWatch', { streamerId: String(streamerId) });
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (returnToChat) {
      if (navigation.canGoBack?.()) {
        navigation.goBack();
        return;
      }
      navigation.navigate('ChatScreen', returnToChat);
      return;
    }
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('MainTabs', { screen: 'Feed' });
  }, [navigation, returnToChat, socket, streamerId]);

  const applyViewerMute = useCallback((muted: boolean) => {
    const lkRoom = roomRef.current;
    if (!lkRoom) return;
    lkRoom.remoteParticipants.forEach((participant) => {
      participant.audioTrackPublications?.forEach((pub) => {
        const track = pub.track;
        if (track?.kind === Track.Kind.Audio) {
          (track as RemoteAudioTrack).setVolume(muted ? 0 : 1);
        }
      });
    });
  }, []);

  const toggleMute = useCallback(() => {
    const next = !isMutedRef.current;
    isMutedRef.current = next;
    setIsMuted(next);
    applyViewerMute(next);
  }, [applyViewerMute]);

  const applyRemoteTracks = useCallback(async () => {
    const lkRoom = roomRef.current;
    if (!lkRoom) return;
    const { screen, camera } = await collectRemoteVideoTracks(lkRoom);
    if (screen) {
      setRemoteScreenTrack((prev: any) => {
        if (prev?.sid !== screen.sid) setScreenRenderKey((k) => k + 1);
        return screen;
      });
    }
    if (camera) {
      setRemoteCameraTrack((prev: any) => (prev?.sid === camera.sid ? prev : camera));
    }
    applyViewerMute(isMutedRef.current);
  }, [applyViewerMute]);

  const closeEmojiPicker = useCallback(() => {
    Animated.timing(emojiPanelAnim, {
      toValue: 0,
      duration: 200,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setEmojiPickerOpen(false);
    });
  }, [emojiPanelAnim]);

  const openEmojiPicker = useCallback(() => {
    setShowLog(false);
    setEmojiPickerOpen(true);
    emojiPanelAnim.setValue(0);
    Animated.spring(emojiPanelAnim, { toValue: 1, ...EMOJI_PICKER_SPRING }).start();
  }, [emojiPanelAnim]);

  const toggleEmojiPicker = useCallback(() => {
    if (emojiPickerOpen) closeEmojiPicker();
    else openEmojiPicker();
  }, [emojiPickerOpen, closeEmojiPicker, openEmojiPicker]);

  const addEmojiFloat = useCallback((emoji: string) => {
    const id = `rx_${++msgCounter.current}_${Date.now()}`;
    const anim = new Animated.Value(0);
    const opacity = new Animated.Value(1);
    const scale = new Animated.Value(0.35);
    const driftX = Math.round((Math.random() - 0.5) * 48);
    const reaction: FloatReaction = { id, emoji, driftX, anim, opacity, scale };
    setFloatReactions((prev) => [...prev.slice(-10), reaction]);

    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 120, useNativeDriver: true }),
      Animated.timing(anim, { toValue: -EMOJI_FLOAT_UP, duration: EMOJI_FLOAT_MS, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(900),
        Animated.timing(opacity, { toValue: 0, duration: 1600, useNativeDriver: true }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      setFloatReactions((prev) => prev.filter((r) => r.id !== id));
      removeTimersRef.current = removeTimersRef.current.filter((t) => t !== timer);
    }, EMOJI_FLOAT_MS + 200);
    removeTimersRef.current.push(timer);
  }, []);

  const sendEmojiReaction = useCallback((emoji: string) => {
    if (!socket || !streamerId) return;
    closeEmojiPicker();
    const sender = user?.name || user?.username || 'Viewer';
    socket.emit('livekit:liveReaction', {
      streamerId: String(streamerId),
      emoji,
      sender,
    });
    addEmojiFloat(emoji);
  }, [socket, streamerId, user, closeEmojiPicker, addEmojiFloat]);

  const addMessage = useCallback((sender: string, text: string) => {
    const id = `msg_${++msgCounter.current}_${Date.now()}`;
    const anim = new Animated.Value(0);
    const opacity = new Animated.Value(1);

    const floatMsg: FloatMsg = { id, sender, text, anim, opacity };
    setFloatMsgs((prev) => [...prev.slice(-6), floatMsg]);
    setChatLog((prev) => [...prev.slice(-100), { id, sender, text }]);

    Animated.parallel([
      Animated.timing(anim, { toValue: -FLOAT_DRIFT_UP, duration: FLOAT_DRIFT_MS, useNativeDriver: true }),
      Animated.sequence([
        Animated.delay(FLOAT_FADE_DELAY_MS),
        Animated.timing(opacity, { toValue: 0, duration: FLOAT_FADE_MS, useNativeDriver: true }),
      ]),
    ]).start();

    const timer = setTimeout(() => {
      setFloatMsgs((prev) => prev.filter((m) => m.id !== id));
      removeTimersRef.current = removeTimersRef.current.filter((t) => t !== timer);
    }, FLOAT_FADE_DELAY_MS + FLOAT_FADE_MS + 200);
    removeTimersRef.current.push(timer);
  }, []);

  useEffect(() => {
    let mounted = true;
    intentionalLeaveRef.current = false;
    closingRef.current = false;
    reconnectAttemptsRef.current = 0;

    const bindRoomEvents = (lkRoom: Room) => {
      const onVideo = (track: any, pub: any) => {
        if (!mounted || track?.kind !== 'video' || !isVideoPublication(pub)) return;
        applyRemoteVideoTrack(
          track,
          pub,
          (t) => {
            setRemoteScreenTrack(t);
            setScreenRenderKey((k) => k + 1);
          },
          setRemoteCameraTrack,
        );
      };

      const onRemotePublication = async (pub: any) => {
        if (!mounted || !isVideoPublication(pub)) return;
        if (!pub.isSubscribed) {
          try { await pub.setSubscribed(true); } catch (_) {}
        }
        if (pub.track) onVideo(pub.track, pub);
      };

      const onAudio = (track: any) => {
        if (!mounted || track?.kind !== Track.Kind.Audio) return;
        (track as RemoteAudioTrack).setVolume(isMutedRef.current ? 0 : 1);
      };

      lkRoom.on(RoomEvent.TrackSubscribed, (track, pub) => {
        if (track.kind === Track.Kind.Audio) onAudio(track);
        else onVideo(track, pub);
      });
      lkRoom.on(RoomEvent.TrackPublished, (pub) => { void onRemotePublication(pub); });
      lkRoom.on(RoomEvent.ParticipantConnected, () => { void applyRemoteTracks(); });
      lkRoom.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
        if (track.kind !== 'video') return;
        if (isScreenSharePublication(pub, track)) setRemoteScreenTrack(null);
        else setRemoteCameraTrack(null);
      });
      lkRoom.on(RoomEvent.Reconnecting, () => {
        if (mounted) setIsReconnecting(true);
      });
      lkRoom.on(RoomEvent.Reconnected, () => {
        if (mounted) {
          setIsReconnecting(false);
          setIsConnected(true);
          void applyRemoteTracks();
        }
      });
      lkRoom.on(RoomEvent.Disconnected, () => {
        if (!mounted || intentionalLeaveRef.current || closingRef.current) return;
        setIsConnected(false);
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = setTimeout(() => {
          void (async () => {
            if (!mounted || intentionalLeaveRef.current || closingRef.current) return;
            const stillActive = await verifyStreamStillActive();
            if (!stillActive) {
              closingRef.current = true;
              leaveLive();
              return;
            }
            if (reconnectAttemptsRef.current < MAX_VIEWER_RECONNECT) {
              reconnectAttemptsRef.current += 1;
              setIsReconnecting(true);
              try { await roomRef.current?.disconnect(); } catch (_) {}
              roomRef.current = null;
              void join();
              return;
            }
            closingRef.current = true;
            leaveLive();
          })();
        }, 2800);
      });
      lkRoom.on(RoomEvent.DataReceived, (payload: Uint8Array) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload));
          if (!mounted) return;
          if (msg.type === 'chat') addMessage(msg.sender, msg.text);
        } catch (_) {}
      });
    };

    const join = async () => {
      try {
        const [statusRes, tokenRes] = await Promise.all([
          fetch(
            `${API_URL}/api/call/livestream/${encodeURIComponent(String(streamerId))}/status`,
            { credentials: 'include' },
          ),
          fetch(`${API_URL}/api/call/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ type: 'viewer', targetId: streamerId }),
          }),
        ]);

        if (statusRes.ok && mounted) {
          const st = await statusRes.json().catch(() => ({}));
          if (st?.active === false) {
            if (mounted) leaveLive();
            return;
          }
        }
        if (!tokenRes.ok || !mounted) return;
        const { token, livekitUrl } = await tokenRes.json();

        const lkRoom = new Room({
          adaptiveStream: true,
          dynacast: true,
          autoSubscribe: true,
        });
        roomRef.current = lkRoom;
        bindRoomEvents(lkRoom);

        await lkRoom.connect(livekitUrl, token);

        try {
          InCallManager.start({ media: 'video', auto: false, ringback: '' });
          InCallManager.setForceSpeakerphoneOn(true);
        } catch (_) {}

        if (mounted) {
          setIsReconnecting(false);
          setIsConnected(true);
          void applyRemoteTracks();
        }
      } catch (_) {
        if (!mounted || intentionalLeaveRef.current || closingRef.current) return;
        const stillActive = await verifyStreamStillActive();
        if (stillActive && reconnectAttemptsRef.current < MAX_VIEWER_RECONNECT) {
          reconnectAttemptsRef.current += 1;
          setIsReconnecting(true);
          reconnectTimerRef.current = setTimeout(() => {
            if (mounted) void join();
          }, 2000);
          return;
        }
        if (mounted) leaveLive();
      }
    };

    if (socket && streamerId) {
      socket.emit('livekit:joinLiveWatch', { streamerId: String(streamerId) });
    }

    join();
    return () => {
      mounted = false;
      intentionalLeaveRef.current = true;
      if (socket && streamerId) {
        socket.emit('livekit:leaveLiveWatch', { streamerId: String(streamerId) });
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      (removeTimersRef.current ?? []).forEach(clearTimeout);
      removeTimersRef.current = [];
      try { InCallManager.stop(); } catch (_) {}
      roomRef.current?.disconnect().catch(() => {});
    };
  }, [streamerId, leaveLive, addMessage, addEmojiFloat, applyRemoteTracks, verifyStreamStillActive, socket]);

  useEffect(() => {
    if (!socket || !streamerId) return;
    const onReaction = (payload: { streamerId?: string; emoji?: string }) => {
      if (String(payload?.streamerId || '') !== String(streamerId)) return;
      if (payload?.emoji) addEmojiFloat(payload.emoji);
    };
    socket.on('livekit:liveReaction', onReaction);
    return () => { socket.off('livekit:liveReaction', onReaction); };
  }, [socket, streamerId, addEmojiFloat]);

  useEffect(() => {
    if (!socket) return;
    const onEnded = async (payload: any) => {
      const sid = payload?.streamerId != null ? String(payload.streamerId) : '';
      if (!sid || sid !== String(streamerId) || closingRef.current) return;
      const room = roomRef.current;
      if (
        room
        && (room.state === ConnectionState.Connected || room.state === ConnectionState.Reconnecting)
      ) {
        const stillActive = await verifyStreamStillActive();
        if (stillActive) return;
      }
      closingRef.current = true;
      roomRef.current?.disconnect().catch(() => {});
      leaveLive();
    };
    socket.on('livekit:streamEnded', onEnded);
    return () => socket.off('livekit:streamEnded', onEnded);
  }, [socket, streamerId, leaveLive, verifyStreamStillActive]);

  const sendChat = useCallback(async () => {
    const text = chatInput.trim();
    if (!text || !roomRef.current || sendingChat) return;
    setSendingChat(true);
    try {
      const msg = { type: 'chat', sender: user?.name || user?.username || 'Viewer', text };
      const encoded = new TextEncoder().encode(JSON.stringify(msg));
      await roomRef.current.localParticipant.publishData(encoded, { reliable: true });
      addMessage(msg.sender, msg.text);
      setChatInput('');
      chatInputRef.current?.blur();
      Keyboard.dismiss();
    } catch (_) {
      // keep text so user can retry
    } finally {
      setSendingChat(false);
    }
  }, [chatInput, user, addMessage, sendingChat]);

  const screenSid = remoteScreenTrack?.sid || 'none';
  const keyboardOpen = keyboardHeight > 0;
  const inputRowPadBottom = keyboardOpen ? 8 : bottomPad;
  const floatAreaBottom = showLog && !keyboardOpen
    ? chatAboveInputBottom + metrics.chatLogH + s(18, metrics.scale)
    : chatAboveInputBottom;
  const canSend = chatInput.trim().length > 0 && !sendingChat;
  const emojiPickerBottom = Animated.add(
    railBottomAnim,
    metrics.actionSlotH * 2 + s(10, metrics.scale),
  );
  const emojiPickerOpacity = emojiPanelAnim;
  const emojiPickerTranslateY = emojiPanelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const emojiPickerScale = emojiPanelAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1],
  });
  const sharePayload = {
    streamerId: String(streamerId || ''),
    streamerName: streamerName || 'User',
    streamerProfilePic: streamerProfilePic || '',
    roomName: roomName || '',
  };

  return (
      <View style={styles.container}>
        {remoteScreenTrack ? (
          <View style={[styles.videoRoot, { width: winW, height: winH }]}>
            <ScreenShareViewer
              key={`live-screen-${screenSid}-${screenRenderKey}`}
              videoTrack={remoteScreenTrack}
              style={StyleSheet.absoluteFill}
              controlsTop={metrics.liveTopBarClear}
              showLabel={false}
            />
          </View>
        ) : remoteCameraTrack ? (
          <View
            style={[styles.videoRoot, { width: winW, height: winH }]}
            pointerEvents="none"
          >
            <VideoView
              key={remoteCameraTrack?.sid || 'cam'}
              videoTrack={remoteCameraTrack}
              style={{ width: winW, height: winH }}
              objectFit={videoFitCover ? 'cover' : 'contain'}
              zOrder={0}
            />
          </View>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
            <Text style={styles.placeholderText}>
              {isReconnecting ? 'Reconnecting…' : isConnected ? 'Waiting for video…' : 'Connecting…'}
            </Text>
          </View>
        )}

        <View style={[styles.topBar, ui.topBar]}>
          <View style={styles.topHostChip}>
            {streamerProfilePic ? (
              <Image source={{ uri: streamerProfilePic }} style={styles.topAvatar} />
            ) : (
              <View style={styles.topAvatarFallback}>
                <Text style={styles.topAvatarFallbackText}>
                  {(streamerName || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}
            <Text style={styles.topName} numberOfLines={1}>{streamerName}</Text>
          </View>
          <View style={styles.topBarSpacer} />
          <View style={styles.livePill}><Text style={styles.livePillText}>🔴 LIVE</Text></View>
          <TouchableOpacity style={[styles.topBtn, { backgroundColor: colors.error }]} onPress={leaveLive}>
            <Text style={{ color: '#fff', fontWeight: 'bold', fontSize: 13 }}>Leave</Text>
          </TouchableOpacity>
        </View>

        <Animated.View
          style={[
            styles.floatArea,
            ui.floatArea,
            {
              bottom: floatAreaBottom,
              height: metrics.floatChatStackH + s(180, metrics.scale),
              opacity: floatOpacityAnim,
            },
          ]}
          pointerEvents="none"
        >
          {floatMsgs.map((m) => <FloatingBubble key={m.id} msg={m} />)}
        </Animated.View>

        <View style={[styles.reactionArea, ui.reactionArea]} pointerEvents="none">
          {floatReactions.map((r) => (
            <FloatingReaction key={r.id} reaction={r} emojiStyle={ui.floatReactionEmoji} />
          ))}
        </View>

        {emojiPickerOpen ? (
          <Pressable style={styles.emojiPickerBackdrop} onPress={closeEmojiPicker} />
        ) : null}

        {emojiPickerOpen ? (
          <Animated.View style={[styles.emojiPickerAnchor, ui.emojiPickerAnchor, { bottom: emojiPickerBottom }]}>
            <Animated.View
              style={[
                styles.emojiPicker,
                {
                  opacity: emojiPickerOpacity,
                  transform: [
                    { translateY: emojiPickerTranslateY },
                    { scale: emojiPickerScale },
                  ],
                },
              ]}
            >
            {LIVE_EMOJIS.map((emoji, index) => {
              const itemScale = emojiPanelAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0.6, 1],
              });
              const itemOpacity = emojiPanelAnim.interpolate({
                inputRange: [0, Math.min(0.15 + index * 0.08, 0.85), 1],
                outputRange: [0, 0, 1],
              });
              return (
                <Animated.View
                  key={emoji}
                  style={{ opacity: itemOpacity, transform: [{ scale: itemScale }] }}
                >
                  <TouchableOpacity
                    style={[styles.emojiPickerBtn, ui.emojiPickerBtn]}
                    onPress={() => { void sendEmojiReaction(emoji); }}
                    activeOpacity={0.65}
                  >
                    <Text style={[styles.emojiPickerEmoji, ui.emojiPickerEmoji]}>{emoji}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
            </Animated.View>
          </Animated.View>
        ) : null}

        {showLog && (
          <Animated.View
            style={[
              styles.logPanel,
              {
                bottom: logBottomAnim,
                height: logHeightAnim,
                right: metrics.actionRailGutter,
                backgroundColor: CHAT_PANEL_BG,
                borderColor: CHAT_PANEL_BORDER,
              },
            ]}
          >
            <FlatList
              ref={flatRef}
              data={chatLog}
              keyExtractor={(item) => item.id}
              onContentSizeChange={() => flatRef.current?.scrollToEnd({ animated: true })}
              renderItem={({ item }) => (
                <Text style={styles.logLine}>
                  <Text style={styles.logSender}>{item.sender}: </Text>
                  {item.text}
                </Text>
              )}
            />
          </Animated.View>
        )}

        <Animated.View style={[styles.actionRail, ui.actionRail, { bottom: railBottomAnim }]}>
          <Animated.View
            style={{
              width: '100%',
              height: metrics.actionSlotH * ACTION_RAIL_SLOTS,
              opacity: railOpacityAnim,
              transform: [{ translateX: railSlideAnim }],
            }}
          >
          {remoteCameraTrack && !remoteScreenTrack ? (
            <View style={[styles.actionSlot, ui.actionSlot, { bottom: metrics.actionSlotH * 4 }]}>
              <LiveActionButton
                ui={ui}
                iconNode={<FitFillIcon filled={videoFitCover} active={videoFitCover} />}
                label={videoFitCover ? 'Fit' : 'Fill'}
                onPress={() => setVideoFitCover((v) => !v)}
                circleStyle={
                  videoFitCover
                    ? {
                        backgroundColor: 'rgba(29, 161, 242, 0.55)',
                        borderColor: 'rgba(147, 197, 253, 0.55)',
                      }
                    : undefined
                }
              />
            </View>
          ) : null}
          <View style={[styles.actionSlot, ui.actionSlot, { bottom: metrics.actionSlotH * 3 }]}>
            <LiveActionButton
              ui={ui}
              icon={isMuted ? '🔇' : '🔊'}
              label={isMuted ? 'Unmute' : 'Mute'}
              onPress={toggleMute}
            />
          </View>
          <View style={[styles.actionSlot, ui.actionSlot, { bottom: metrics.actionSlotH * 2 }]}>
            <LiveActionButton
              ui={ui}
              icon="📤"
              label="Share"
              onPress={() => setShareOpen(true)}
              circleStyle={{ backgroundColor: colors.primary, borderColor: 'transparent' }}
            />
          </View>
          <View style={[styles.actionSlot, ui.actionSlot, { bottom: metrics.actionSlotH }]}>
            <LiveActionButton
              ui={ui}
              icon="💬"
              label="Chat"
              onPress={() => {
                closeEmojiPicker();
                setShowLog((v) => !v);
              }}
              circleStyle={
                showLog
                  ? {
                      backgroundColor: 'rgba(29, 161, 242, 0.82)',
                      borderColor: 'rgba(147, 197, 253, 0.65)',
                    }
                  : undefined
              }
            />
          </View>
          <View style={[styles.actionSlot, ui.actionSlot, { bottom: 0 }]}>
            <LiveActionButton
              ui={ui}
              iconNode={<ReactHeartIcon active={emojiPickerOpen} />}
              label="React"
              onPress={toggleEmojiPicker}
              circleStyle={
                emojiPickerOpen
                  ? {
                      backgroundColor: 'rgba(255,255,255,0.92)',
                      borderColor: 'rgba(255,255,255,0.95)',
                    }
                  : undefined
              }
            />
          </View>
          </Animated.View>
        </Animated.View>

        <Animated.View
          style={[
            styles.inputRow,
            { bottom: inputBottomAnim, paddingBottom: inputRowPadBottom },
          ]}
        >
          <TextInput
            ref={chatInputRef}
            style={[styles.textInput, ui.textInput, { color: '#fff', borderColor: 'rgba(255,255,255,0.3)' }]}
            placeholder="Say something…"
            placeholderTextColor="#888"
            value={chatInput}
            onChangeText={setChatInput}
            onSubmitEditing={sendChat}
            returnKeyType="send"
            blurOnSubmit
          />
          <TouchableOpacity
            style={[
              styles.sendBtn,
              ui.sendBtn,
              {
                backgroundColor: canSend ? colors.primary : 'rgba(255,255,255,0.18)',
                opacity: sendingChat ? 0.85 : 1,
              },
            ]}
            onPress={sendChat}
            disabled={!canSend && !sendingChat}
            activeOpacity={0.8}
          >
            {sendingChat ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.sendBtnText}>Send</Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        <LiveShareModal
          visible={shareOpen}
          onClose={() => setShareOpen(false)}
          live={sharePayload}
        />
      </View>
  );
};

const styles = StyleSheet.create({
  container:        { flex: 1, backgroundColor: '#000' },
  videoRoot:        {
    position: 'absolute', top: 0, left: 0, overflow: 'hidden',
    backgroundColor: '#000',
  },
  placeholder:      { justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' },
  placeholderText:  { color: '#888', fontSize: 15, textAlign: 'center', paddingHorizontal: 24 },
  topBar:           {
    position: 'absolute', left: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 8, zIndex: 10,
  },
  topBarSpacer:     { flex: 1 },
  topHostChip:      {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    flexShrink: 1,
    maxWidth: '52%',
    backgroundColor: 'rgba(36, 78, 118, 0.82)',
    borderRadius: 22,
    paddingVertical: 5,
    paddingLeft: 5,
    paddingRight: 10,
    borderWidth: 1,
    borderColor: 'rgba(147, 197, 253, 0.35)',
  },
  topAvatar:        { width: 32, height: 32, borderRadius: 16 },
  topAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(29,161,242,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topAvatarFallbackText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  topName:          {
    color: '#F0F9FF',
    fontWeight: 'bold',
    fontSize: 14,
    flexShrink: 1,
  },
  livePill:         { backgroundColor: 'red', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  livePillText:     { color: '#fff', fontWeight: 'bold', fontSize: 12 },
  topBtn:           { paddingVertical: 5, paddingHorizontal: 14, borderRadius: 16 },
  floatArea:        { position: 'absolute', left: 12, justifyContent: 'flex-end' },
  floatBubble:      {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 6,
    marginBottom: 6, alignSelf: 'flex-start',
  },
  floatSender:      { color: '#FFD700', fontWeight: 'bold', fontSize: 13 },
  floatText:        { color: '#fff', fontSize: 13 },
  reactionArea:     {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '40%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    zIndex: 8,
  },
  floatReaction:    { position: 'absolute', bottom: 0, alignItems: 'center' },
  floatReactionEmoji: {},
  reactHeartIcon:   { fontSize: 24, color: '#FFFFFF', fontWeight: '700' },
  reactHeartIconOn: { color: '#F43F5E' },
  emojiPickerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 28,
  },
  emojiPickerAnchor: {
    position: 'absolute',
    zIndex: 30,
  },
  emojiPicker:      {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.98)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 10,
    gap: 4,
  },
  emojiPickerBtn:   {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emojiPickerEmoji: {
    textAlign: 'center',
    ...(Platform.OS === 'android' ? { includeFontPadding: false as const } : {}),
  },
  logPanel:         {
    position: 'absolute', left: 12,
    borderRadius: 16, padding: 10, zIndex: 12,
    borderWidth: 1,
  },
  logLine:          { color: '#E8F4FC', fontSize: 13, marginBottom: 4, lineHeight: 18 },
  logSender:        { color: '#7DD3FC', fontWeight: 'bold' },
  actionRail: {
    position: 'absolute',
    zIndex: 25,
  },
  fitFillIconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fitFillOuter: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  fitFillOuterActive: {
    borderColor: '#93C5FD',
    backgroundColor: 'rgba(29,161,242,0.2)',
  },
  fitFillInner: {
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.9)',
  },
  fitFillInnerFit: {
    width: 9,
    height: 6,
  },
  fitFillInnerFull: {
    width: 16,
    height: 16,
    borderRadius: 1,
  },
  actionSlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  actionSlotReserved: {},
  actionItem: { alignItems: 'center' },
  actionCircle: {
    borderRadius: 9999,
    backgroundColor: 'rgba(0,0,0,0.48)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIcon: {},
  actionLabel: {
    color: '#fff',
    fontWeight: '600',
    marginTop: 5,
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  inputRow:         {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 10,
  },
  textInput:        {
    flex: 1,
    borderWidth: 1,
    borderRadius: 9999,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  sendBtn:          {
    paddingHorizontal: 16,
    borderRadius: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
});

export default LiveViewerScreen;
