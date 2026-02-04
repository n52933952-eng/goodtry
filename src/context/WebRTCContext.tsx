import React, { createContext, useContext, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { Platform, PermissionsAndroid, DeviceEventEmitter, AppState } from 'react-native';
import InCallManager from 'react-native-incall-manager';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import fcmService from '../services/fcmService';
import { WEBRTC_CONFIG } from '../utils/constants';
import { clearCallData, getPendingCallData } from '../services/callData';
import { apiService } from '../services/api';

interface Call {
  isReceivingCall?: boolean;
  from?: string;
  userToCall?: string;
  name?: string;
  signal?: any;
  callType?: 'audio' | 'video';
}

interface WebRTCContextType {
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  call: Call;
  callAccepted: boolean;
  callEnded: boolean;
  isCalling: boolean;
  callType: 'audio' | 'video';
  callUser: (userId: string, userName: string, type: 'audio' | 'video') => Promise<void>;
  answerCall: () => Promise<void>;
  leaveCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  switchCamera: () => void;
  toggleSpeaker: () => void;
  isMuted: boolean;
  isCameraOff: boolean;
  isSpeakerOn: boolean;
  connectionState: string;
  iceConnectionState: string;
  callDuration: number;
  /** Ref set when call connects – use for local duration ticker so context doesn't re-render every second */
  callStartTimeRef: React.MutableRefObject<number | null>;
  displayConnectedFromPeer: boolean; // true when we received callConnected (show "Connected" + timer for both)
  pendingCancel: boolean; // Flag to prevent navigation when cancel is in progress
  callBusyReason: string | null; // 'offline' | 'busy' | null – for WhatsApp-like messages
  /** When user pressed Answer on native UI, caller ID so AppNavigator can pass shouldAutoAnswer/isFromNotification and not overwrite with socket params */
  incomingCallFromNotificationCallerId: string | null;
  /** Synchronous getter so AppNavigator sees cleared value immediately after CallCanceled (no wait for React state) */
  getIncomingCallFromNotificationCallerId: () => string | null;
  setIncomingCallFromNotification: (callerId: string, callerName: string, callType: 'audio' | 'video', shouldAutoAnswer?: boolean) => void;
  requestCallSignalForCaller: (callerId: string) => void;
}

const WebRTCContext = createContext<WebRTCContextType | undefined>(undefined);

export const WebRTCProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket } = useSocket();
  const { user } = useUser();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const [call, setCall] = useState<Call>({});
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [iceConnectionState, setIceConnectionState] = useState<string>('new');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [displayConnectedFromPeer, setDisplayConnectedFromPeer] = useState(false);
  const [pendingCancel, setPendingCancel] = useState<boolean>(false); // Track if cancel is in progress to prevent navigation
  const [callBusyReason, setCallBusyReason] = useState<string | null>(null); // 'offline' | 'busy' – for UX message
  const [socketConnectKey, setSocketConnectKey] = useState(0); // Bump on each connect (incl. reconnect) to re-attach listeners
  const [incomingCallFromNotificationCallerId, setIncomingCallFromNotificationCallerId] = useState<string | null>(null); // User pressed Answer on native UI – AppNavigator uses this to pass shouldAutoAnswer
  const incomingCallFromNotificationCallerIdRef = useRef<string | null>(null); // Mirrors state so AppNavigator reads cleared value immediately after CallCanceled (no state timing)

  // Keep a fresh snapshot for AppState handlers (avoid stale closures).
  const callStateSnapshotRef = useRef<{ call: Call; callAccepted: boolean; isCalling: boolean }>({
    call: {},
    callAccepted: false,
    isCalling: false,
  });
  useEffect(() => {
    callStateSnapshotRef.current = { call, callAccepted, isCalling };
  }, [call, callAccepted, isCalling]);

  // Keep stream refs in sync so cleanupPeer always sees latest (avoids stale closures in resetAllCallState/leaveCall)
  useEffect(() => {
    localStreamRef.current = localStream;
    remoteStreamRef.current = remoteStream;
  }, [localStream, remoteStream]);

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  /** Merged remote stream for current call – collect all ontrack events so B sees A's video when answering from off-app (audio/video can arrive as separate tracks) */
  const mergedRemoteStreamRef = useRef<MediaStream | null>(null);
  const remoteUserIdRef = useRef<string | null>(null);
  const persistentCallerIdRef = useRef<string | null>(null); // Persistent caller ID that survives cleanup (for timeout handling)
  const pendingIceCandidates = useRef<RTCIceCandidate[]>([]);
  const pendingAnswerRef = useRef<RTCSessionDescription | null>(null); // Queue answer if peer connection not ready
  const shouldAutoAnswerRef = useRef<string | null>(null);
  const pendingSignalRequestRef = useRef<{ callerId: string; receiverId: string } | null>(null);
  const reconnectionAttempts = useRef<number>(0);
  const callStartTimeRef = useRef<number | null>(null);
  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const processingPendingCancelRef = useRef<boolean>(false);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const iceDisconnectedTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track ICE disconnected timeout
  const connectionDisconnectedDebounceRef = useRef<NodeJS.Timeout | null>(null); // Debounce brief 'disconnected' so Connected UI doesn't flicker
  const iceDisconnectedDebounceRef = useRef<NodeJS.Timeout | null>(null); // Same for ICE disconnected
  const userIdRef = useRef<string | undefined>(user?._id); // Store user ID in ref for reliable checks
  const isAnsweringRef = useRef(false); // Prevent duplicate answer attempts
  const processingCallUserRef = useRef(false); // Prevent duplicate callUser event processing
  const processingCallCanceledRef = useRef(false); // Prevent duplicate CallCanceled event processing
  const callWasCanceledRef = useRef(false); // Track if call was canceled to ignore stale answers
  const lastProcessedSignalSdpRef = useRef<string | null>(null); // Track last processed signal SDP to prevent duplicates
  const requestSignalTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track requestSignal timeout to cancel it
  const hasRequestedSignalRef = useRef<{ callerId: string; timestamp: number } | null>(null); // Track if we've already requested signal for this call
  const hasReceivedSignalForCallerRef = useRef<string | null>(null); // P0: Track signal received per caller (ref avoids stale closure in retry timeout)
  const receiverTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track receiver timeout - clears "Incoming call..." if no connection
  const signalWaitTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Notification flow: end call if no signal within 15s, cancelCall to caller
  const justClearedStaleStateRef = useRef<boolean>(false); // Track if we just cleared stale state (to allow re-sent calls after reconnect)
  const lastCallSignalReceivedRef = useRef<number | null>(null); // Track when call signal was last received (timestamp) - prevents clearing new calls
  const activeCallIdRef = useRef<string | null>(null); // FIRM: unique call id for deduplication – ignore events for other calls
  const lastCanceledCallRef = useRef<{ from: string; userToCall: string; callId?: string; at: number } | null>(null); // Ignore stale callUser after cancel
  const lastCallCanceledProcessedAtRef = useRef<number>(0); // Dedupe CallCanceled (backend may emit multiple times)
  const preFetchedStreamRef = useRef<MediaStream | null>(null); // Pre-fetched stream for faster answer (notification flow)
  const preFetchedStreamTypeRef = useRef<'audio' | 'video' | null>(null);
  const preFetchAbortedRef = useRef<boolean>(false); // When answerCall uses getMediaStream, abort pre-fetch so it releases device
  const preAcquiredStreamRef = useRef<MediaStream | null>(null); // Madechess-style: stream ready for next call (in-app)
  const preAcquiredStreamTypeRef = useRef<'audio' | 'video' | null>(null);
  const callUserInProgressRef = useRef(false); // User is making outgoing call – skip preAcquireStream
  const getUserMediaInProgressRef = useRef<boolean>(false); // Mutex: only one getUserMedia at a time (Android can hang with concurrent)
  const mediaWarmupTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Debounced post-call media warmup
  const lastCallEndedAtRef = useRef<number>(0); // When call/cleanup last ran – Android needs time to release camera
  const lastCallTypeRef = useRef<'audio' | 'video'>('video'); // Track last call type for warmup
  const iceServersConfigRef = useRef<Array<{ urls: string; username?: string; credential?: string }> | null>(null); // Fetched from backend (TURN credentials server-side)

  // Update user ID ref when user changes (for reliable checks in socket handlers)
  useEffect(() => {
    userIdRef.current = user?._id;
  }, [user?._id]);

  // Fetch ICE servers from backend (TURN credentials stay server-side)
  useEffect(() => {
    if (!user?._id) return;
    apiService
      .get('/api/call/ice-servers')
      .then((data: { iceServers?: Array<{ urls: string; username?: string; credential?: string }> }) => {
        if (data?.iceServers?.length) {
          iceServersConfigRef.current = data.iceServers;
          console.log('✅ [WebRTC] ICE servers loaded from backend (STUN + TURN)');
        }
      })
      .catch((err) => {
        console.warn('⚠️ [WebRTC] Could not fetch ICE servers, using STUN only:', (err as Error)?.message ?? err);
        iceServersConfigRef.current = null;
      });
  }, [user?._id]);

  useEffect(() => {
    lastCallTypeRef.current = callType;
  }, [callType]);

  useEffect(() => {
    return () => {
      if (mediaWarmupTimeoutRef.current) {
        clearTimeout(mediaWarmupTimeoutRef.current);
        mediaWarmupTimeoutRef.current = null;
      }
    };
  }, []);

  // Re-attach listeners on every connect (incl. reconnect). After background→Answer, we get a new socket;
  // without this we'd never receive callUser. Do NOT emit requestCallSignal here – listener effect will
  // re-run (socketConnectKey bump) and emit after attaching listeners to avoid missing callUser response.
  useEffect(() => {
    const sk = socket as any;
    if (!socket || typeof sk.addConnectListener !== 'function') return;
    const onConnect = () => {
      setSocketConnectKey((k) => k + 1);
    };
    const remove = sk.addConnectListener(onConnect);
    const sock = socket.getSocket?.();
    if (sock?.connected) onConnect();
    return () => { remove?.(); };
  }, [socket, user]);

  // Request permissions for camera and microphone (Android)
  const requestPermissions = useCallback(async (requireCamera: boolean = true) => {
    if (Platform.OS === 'android') {
      try {
        const permissions: string[] = [
          PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        ];
        
        // Only request camera permission if needed (for video calls)
        if (requireCamera) {
          permissions.push(PermissionsAndroid.PERMISSIONS.CAMERA);
        }
        
        const granted = await PermissionsAndroid.requestMultiple(permissions);
        
        const audioGranted = granted['android.permission.RECORD_AUDIO'] === PermissionsAndroid.RESULTS.GRANTED;
        const cameraGranted = requireCamera 
          ? granted['android.permission.CAMERA'] === PermissionsAndroid.RESULTS.GRANTED 
          : true; // Not required for audio-only calls
        
        if (!audioGranted) {
          console.error('❌ Audio permission not granted');
          return false;
        }
        
        if (requireCamera && !cameraGranted) {
          console.error('❌ Camera permission not granted');
          return false;
        }
        
        console.log('✅ Permissions granted:', { audio: audioGranted, camera: cameraGranted || !requireCamera });
        return true;
      } catch (error) {
        console.error('❌ Error requesting permissions:', error);
        return false;
      }
    }
    return true;
  }, []);

  const acquireGetUserMediaLock = useCallback(async (label: string, maxWaitMs: number = 4000): Promise<(() => void) | null> => {
    const start = Date.now();
    while (getUserMediaInProgressRef.current) {
      if (Date.now() - start > maxWaitMs) {
        console.warn(`⚠️ [WebRTC] ${label}: Timed out waiting for getUserMedia lock`);
        return null;
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    getUserMediaInProgressRef.current = true;
    return () => {
      getUserMediaInProgressRef.current = false;
    };
  }, []);

  // Initialize media stream. skipLock=true for outgoing calls only (avoids lock blocking callback flow).
  const getMediaStream = async (type: 'audio' | 'video', skipLock: boolean = false) => {
    let releaseLock: (() => void) | null = null;
    if (!skipLock) {
      const lock = await acquireGetUserMediaLock(`getMediaStream:${type}`);
      if (!lock) {
        getUserMediaInProgressRef.current = false;
        await new Promise((r) => setTimeout(r, 300));
        const retry = await acquireGetUserMediaLock(`getMediaStream:${type}:retry`);
        if (!retry) throw new Error('Camera/microphone still resetting. Please retry.');
        releaseLock = retry;
      } else {
        releaseLock = lock;
      }
    }
    try {
      // Request permissions based on call type (only camera for video calls)
      const requireCamera = type === 'video';
      const hasPermissions = await requestPermissions(requireCamera);
      if (!hasPermissions) {
        const missingPermissions = requireCamera
          ? 'Camera and microphone permissions are required'
          : 'Microphone permission is required';
        throw new Error(missingPermissions);
      }

      const constraints = {
        audio: true,
        video: type === 'video' ? {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        } : false,
      };

      const stream = await mediaDevices.getUserMedia(constraints);
      setLocalStream(stream);
      
      // Initialize InCallManager for audio routing
      // For video calls, default to speaker
      // For audio calls, default to earpiece
      const media = type === 'video' ? 'video' : 'audio';
      const auto = type === 'video'; // Auto-enable speaker for video calls
      
      InCallManager.start({ media, auto, ringback: '' });
      console.log(`📞 [WebRTC] InCallManager started - media: ${media}, speaker: ${auto}`);
      
      // Set initial speaker state
      setIsSpeakerOn(auto);
      
      return stream;
    } catch (error) {
      console.error('Error getting media stream:', error);
      throw error;
    } finally {
      if (releaseLock) releaseLock();
    }
  };

  // Pre-fetch media stream for faster connection when answering from notification
  const preFetchMediaStreamForAnswer = useCallback(async (type: 'audio' | 'video') => {
    preFetchAbortedRef.current = false;
    if (preFetchedStreamRef.current) {
      preFetchedStreamRef.current.getTracks().forEach((t) => t.stop());
      preFetchedStreamRef.current = null;
      preFetchedStreamTypeRef.current = null;
    }
    const requireCamera = type === 'video';
    const hasPermissions = await requestPermissions(requireCamera);
    if (!hasPermissions) return;
    const releaseLock = await acquireGetUserMediaLock(`prefetch:${type}`, 2500);
    if (!releaseLock) return;
    try {
      const constraints = {
        audio: true,
        video: type === 'video' ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      };
      const stream = await mediaDevices.getUserMedia(constraints);
      if (preFetchAbortedRef.current || preFetchedStreamRef.current || !shouldAutoAnswerRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.getAudioTracks().forEach((track) => {
        if (!track.enabled) track.enabled = true;
      });
      preFetchedStreamRef.current = stream;
      preFetchedStreamTypeRef.current = type;
      console.log('✅ [NotificationCall] Pre-fetched media stream for faster answer');
    } catch (e) {
      console.warn('⚠️ [NotificationCall] Pre-fetch media failed:', (e as Error)?.message ?? e);
    } finally {
      releaseLock();
    }
  }, [acquireGetUserMediaLock, requestPermissions]);

  const clearPreFetchedStream = useCallback(() => {
    preFetchAbortedRef.current = true;
    if (preFetchedStreamRef.current) {
      preFetchedStreamRef.current.getTracks().forEach((t) => t.stop());
      preFetchedStreamRef.current = null;
      preFetchedStreamTypeRef.current = null;
      console.log('🧹 [WebRTC] Cleared pre-fetched stream');
    }
  }, []);

  /** Madechess-style: Pre-acquire stream when app is ready so callUser/answerCall (in-app) reuse it.
   *  Off-app incoming calls still use preFetchedStreamRef or getMediaStream. */
  const preAcquireStream = useCallback(async (reason: string = 'post-reset') => {
    if (!user?._id) return;
    const sock = socket?.getSocket?.();
    if (!sock?.connected) return;
    if (shouldAutoAnswerRef.current) return;
    if (isAnsweringRef.current) return;
    if (callUserInProgressRef.current) return;
    if (peerConnection.current || localStreamRef.current) return;
    const releaseLock = await acquireGetUserMediaLock(`preAcquire:${reason}`, 2500);
    if (!releaseLock) return;
    try {
      const type = lastCallTypeRef.current || 'video';
      const requireCamera = type === 'video';
      const hasPermissions = await requestPermissions(requireCamera);
      if (!hasPermissions) return;
      if (isAnsweringRef.current || callUserInProgressRef.current) {
        releaseLock();
        return;
      }
      if (preAcquiredStreamRef.current) {
        preAcquiredStreamRef.current.getTracks().forEach((t) => t.stop());
        preAcquiredStreamRef.current = null;
        preAcquiredStreamTypeRef.current = null;
      }
      const constraints = {
        audio: true,
        video: type === 'video' ? { facingMode: 'user' as const, width: { ideal: 1280 }, height: { ideal: 720 } } : false,
      };
      const stream = await mediaDevices.getUserMedia(constraints);
      stream.getAudioTracks().forEach((track) => {
        if (!track.enabled) track.enabled = true;
      });
      preAcquiredStreamRef.current = stream;
      preAcquiredStreamTypeRef.current = type;
      console.log('✅ [WebRTC] Pre-acquired stream (madechess-style) ready for next call', { type, reason });
    } catch (e) {
      console.warn('⚠️ [WebRTC] Pre-acquire stream failed:', (e as Error)?.message ?? e);
    } finally {
      releaseLock();
    }
  }, [acquireGetUserMediaLock, requestPermissions, user?._id, socket]);

  const scheduleMediaWarmup = useCallback((reason: string = 'post-reset') => {
    if (mediaWarmupTimeoutRef.current) {
      clearTimeout(mediaWarmupTimeoutRef.current);
      mediaWarmupTimeoutRef.current = null;
    }
    mediaWarmupTimeoutRef.current = setTimeout(async () => {
      const preferredType = lastCallTypeRef.current || 'video';
      console.log('🔄 [WebRTC] Priming media devices for next call', { reason, preferredType });
      const releaseLock = await acquireGetUserMediaLock(`warmup:${reason}`, 2000);
      if (!releaseLock) {
        console.log('⚠️ [WebRTC] Skipping media warmup – lock busy');
        return;
      }
      try {
        const requireCamera = preferredType === 'video';
        const hasPermissions = await requestPermissions(requireCamera);
        if (!hasPermissions) return;
        const constraints = {
          audio: true,
          video: requireCamera
            ? { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
            : false,
        };
        const warmupStream = await mediaDevices.getUserMedia(constraints);
        warmupStream.getAudioTracks().forEach((track) => {
          if (!track.enabled) track.enabled = true;
        });
        warmupStream.getTracks().forEach((t) => t.stop());
        console.log('✅ [WebRTC] Media devices primed for the next call');
      } catch (error) {
        console.warn('⚠️ [WebRTC] Media warmup failed:', (error as Error)?.message ?? error);
      } finally {
        releaseLock();
      }
    }, 600);
  }, [acquireGetUserMediaLock, requestPermissions]);

  // DISABLED: Pre-acquire on socket connect – camera stayed on when entering app (WhatsApp doesn't do this)
  // useEffect(() => { ... preAcquireStream('socket-connect'); }, [...]);

  // Create peer connection with enhanced monitoring
  const createPeerConnection = (stream: MediaStream) => {
    const servers = iceServersConfigRef.current ?? [...WEBRTC_CONFIG.STUN_SERVERS];
    const configuration = { iceServers: servers };
    const pc = new RTCPeerConnection(configuration);

    stream.getTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Handle remote stream
    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        console.log('✅ [WebRTC] Remote stream received');
        setRemoteStream(event.streams[0]);
      }
    };

    // Handle ICE candidates (Trickle ICE - send immediately for better performance)
    pc.onicecandidate = (event) => {
      if (event.candidate && socket && remoteUserIdRef.current) {
        // CRITICAL: Use persistentCallerIdRef as fallback if remoteUserIdRef is null
        // This ensures ICE candidates can be sent even if remoteUserIdRef was cleared during cleanup
        const targetUserId = remoteUserIdRef.current || persistentCallerIdRef.current;
        const currentUserId = userIdRef.current || user?._id;
        
        if (targetUserId && currentUserId) {
          console.log('🧊 [WebRTC] ICE candidate generated:', {
            type: event.candidate.type,
            candidate: event.candidate.candidate?.substring(0, 50) + '...',
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          });
          console.log('🧊 [WebRTC] Sending ICE candidate to:', targetUserId, {
            fromRemoteUserIdRef: !!remoteUserIdRef.current,
            fromPersistentCallerIdRef: !!persistentCallerIdRef.current,
          });
          const icePayload: any = { userToCall: targetUserId, candidate: event.candidate, from: currentUserId };
          if (activeCallIdRef.current) icePayload.callId = activeCallIdRef.current;
          socket.emit('iceCandidate', icePayload);
          console.log('✅ [WebRTC] ICE candidate sent');
        } else {
          console.warn('⚠️ [WebRTC] ICE candidate generated but missing target user ID:', {
            hasCandidate: !!event.candidate,
            hasSocket: !!socket,
            remoteUserId: remoteUserIdRef.current,
            persistentCallerId: persistentCallerIdRef.current,
            currentUserId,
          });
        }
      } else if (!event.candidate) {
        console.log('✅ [WebRTC] ICE candidate gathering complete (null candidate received)');
      } else {
        console.log('⚠️ [WebRTC] ICE candidate generated but missing requirements:', {
          hasCandidate: !!event.candidate,
          hasSocket: !!socket,
          remoteUserId: remoteUserIdRef.current,
          persistentCallerId: persistentCallerIdRef.current,
        });
      }
    };

    // Handle ICE candidate errors (non-fatal, connection can still succeed)
    pc.onicecandidateerror = (event) => {
      // Some ICE errors are expected and can be ignored
      if (event.errorCode && event.errorCode !== 701 && event.errorCode !== 702) {
        console.warn('⚠️ [WebRTC] ICE candidate error:', event.errorCode, event.errorText);
      }
    };

    // Monitor connection state (overall peer connection state)
    pc.onconnectionstatechange = () => {
      // Guard: ignore events from old/closed peer connections after cleanup.
      if (peerConnection.current !== pc) return;
      // Clear connection timeout when we know we're ending – prevents timeout firing after we leaveCall
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
        }
      }
      const state = pc.connectionState;
      console.log(`📡 [WebRTC] Connection state: ${state}`);

      // FIRM: Debounce brief 'disconnected' (ICE renegotiation) so Connected UI doesn't flicker on second call
      if (state === 'disconnected') {
        if (connectionDisconnectedDebounceRef.current) {
          clearTimeout(connectionDisconnectedDebounceRef.current);
          connectionDisconnectedDebounceRef.current = null;
        }
        connectionDisconnectedDebounceRef.current = setTimeout(() => {
          connectionDisconnectedDebounceRef.current = null;
          if (peerConnection.current === pc && pc.connectionState === 'disconnected') {
            setConnectionState('disconnected');
          }
        }, 1500);
        console.warn('⚠️ [WebRTC] Connection disconnected (debounced 1.5s)');
        return;
      }
      if (state === 'connected' || state === 'closed' || state === 'failed') {
        if (connectionDisconnectedDebounceRef.current) {
          clearTimeout(connectionDisconnectedDebounceRef.current);
          connectionDisconnectedDebounceRef.current = null;
        }
      }
      setConnectionState(state);

      switch (state) {
        case 'connected':
          console.log('✅ [WebRTC] Connection established!');
          // Clear connection timeout
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          // Start call duration timer (only if not already started)
          // CRITICAL: Check if timer is already running before creating a new one
          // This prevents duplicate timer starts even if event fires multiple times
          setDisplayConnectedFromPeer(true);
          if (!callDurationIntervalRef.current) {
            // Reset callDuration to 0 so CallScreen shows "Connected" first (no interval here – CallScreen runs its own to avoid re-rendering ChatScreen every second)
            setCallDuration(0);
            const startTime = Date.now();
            callStartTimeRef.current = startTime;
            callDurationIntervalRef.current = true as any; // mark that timer was started (cleared in cleanup)
            console.log('🕐 [WebRTC] Starting timer...', {
              userId: user?._id,
              isCaller: !call.isReceivingCall,
              startTime
            });
            // Sync "Connected" + timer to other peer so both show same status
            const to = remoteUserIdRef.current || persistentCallerIdRef.current;
            if (socket && to && user?._id) {
              const connectedPayload: { to: string; startTime: number; callId?: string } = { to, startTime };
              if (activeCallIdRef.current) connectedPayload.callId = activeCallIdRef.current;
              socket.emit('callConnected', connectedPayload);
            }
          } else {
            console.log('⚠️ [WebRTC] Timer already running, skipping duplicate initialization', {
              hasStartTime: !!callStartTimeRef.current,
              hasInterval: !!callDurationIntervalRef.current,
              userId: user?._id,
              isCaller: !call.isReceivingCall
            });
          }
          // Reset reconnection attempts on successful connection
          reconnectionAttempts.current = 0;
          break;
        case 'disconnected':
          console.warn('⚠️ [WebRTC] Connection disconnected');
          break;
        case 'failed':
          console.error('❌ [WebRTC] Connection failed');
          // Stop call duration timer immediately so UI does not show running time after failure
          callDurationIntervalRef.current = null;
          callStartTimeRef.current = null;
          setCallDuration(0);
          // Attempt reconnection if under max attempts
          if (reconnectionAttempts.current < WEBRTC_CONFIG.MAX_RECONNECTION_ATTEMPTS) {
            reconnectionAttempts.current++;
            console.log(`🔄 [WebRTC] Attempting reconnection (${reconnectionAttempts.current}/${WEBRTC_CONFIG.MAX_RECONNECTION_ATTEMPTS})...`);
            setTimeout(() => {
              if (peerConnection.current && peerConnection.current.connectionState === 'failed') {
                // Try to restart ICE
                peerConnection.current.restartIce();
              }
            }, 2000);
          } else {
            console.error('❌ [WebRTC] Max reconnection attempts reached, ending call');
            // Notify the other user via socket that call failed
            const otherUserId = call.isReceivingCall ? call.from : call.userToCall;
            if (socket && otherUserId && user?._id) {
              console.log('📤 [WebRTC] Notifying other user about connection failure');
              socket.emit('cancelCall', {
                conversationId: otherUserId,
                sender: user._id,
              });
            }
            leaveCall();
          }
          break;
        case 'closed':
          console.log('📴 [WebRTC] Connection closed');
          // Full cleanup when peer closes (other side ended or we closed). Do NOT emit cancelCall.
          if (callAccepted || isCalling || call.isReceivingCall) {
            console.log('📴 [WebRTC] Connection closed – full reset so user can call again');
            resetAllCallState();
          }
          break;
      }
    };

    // Monitor ICE connection state (NAT traversal state)
    pc.oniceconnectionstatechange = () => {
      // Guard: ignore events from old/closed peer connections after cleanup.
      if (peerConnection.current !== pc) return;
      const state = pc.iceConnectionState;
      console.log(`🧊 [WebRTC] ICE connection state: ${state}`);

      // FIRM: Debounce brief ICE 'disconnected' so Connected UI doesn't flicker on second call
      if (state === 'disconnected') {
        if (iceDisconnectedDebounceRef.current) {
          clearTimeout(iceDisconnectedDebounceRef.current);
          iceDisconnectedDebounceRef.current = null;
        }
        iceDisconnectedDebounceRef.current = setTimeout(() => {
          iceDisconnectedDebounceRef.current = null;
          if (peerConnection.current === pc && pc.iceConnectionState === 'disconnected') {
            setIceConnectionState('disconnected');
          }
        }, 1500);
        return;
      }
      if (state === 'connected' || state === 'completed' || state === 'closed' || state === 'failed') {
        if (iceDisconnectedDebounceRef.current) {
          clearTimeout(iceDisconnectedDebounceRef.current);
          iceDisconnectedDebounceRef.current = null;
        }
      }
      setIceConnectionState(state);

      switch (state) {
        case 'connected':
        case 'completed':
          console.log('✅ [WebRTC] ICE connection established');
          // Clear connection timeout on successful ICE connection
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          // Clear ICE disconnected timeout if connection recovered
          if (iceDisconnectedTimeoutRef.current) {
            clearTimeout(iceDisconnectedTimeoutRef.current);
            iceDisconnectedTimeoutRef.current = null;
            console.log('✅ [WebRTC] ICE connection recovered - cleared disconnected timeout');
          }
          // Also start timer here if connection state is also connected (for both users)
          // This ensures timer starts even if connectionstatechange fires before iceconnectionstatechange
          if (pc.connectionState === 'connected' && !callDurationIntervalRef.current) {
            setCallDuration(0);
            const startTime = Date.now();
            callStartTimeRef.current = startTime;
            callDurationIntervalRef.current = true as any;
            console.log('✅ [WebRTC] Call duration timer started (from ICE connection state)', {
              userId: user?._id,
              isCaller: !call.isReceivingCall
            });
            const to = remoteUserIdRef.current || persistentCallerIdRef.current;
            if (socket && to && user?._id) {
              const connectedPayload: { to: string; startTime: number; callId?: string } = { to, startTime };
              if (activeCallIdRef.current) connectedPayload.callId = activeCallIdRef.current;
              socket.emit('callConnected', connectedPayload);
            }
          }
          break;
        case 'failed':
          console.error('❌ [WebRTC] ICE connection failed');
          callDurationIntervalRef.current = null;
          callStartTimeRef.current = null;
          setCallDuration(0);
          // Try restartIce (can recover from brief network blips) - connection handler also tries, this gives earlier attempt
          if (reconnectionAttempts.current < WEBRTC_CONFIG.MAX_RECONNECTION_ATTEMPTS &&
              peerConnection.current === pc && typeof pc.restartIce === 'function') {
            reconnectionAttempts.current++;
            console.log(`🔄 [WebRTC] ICE failed – attempting restartIce (${reconnectionAttempts.current}/${WEBRTC_CONFIG.MAX_RECONNECTION_ATTEMPTS})`);
            setTimeout(() => {
              if (peerConnection.current === pc && pc.iceConnectionState === 'failed') {
                try {
                  peerConnection.current.restartIce();
                  console.log('✅ [WebRTC] restartIce() called');
                } catch (e) {
                  console.warn('⚠️ [WebRTC] restartIce failed:', e);
                }
              }
            }, 1000);
          } else if (pc.connectionState === 'failed') {
            console.error('❌ [WebRTC] ICE failed, connection also failed – will end call');
            setTimeout(() => {
              if (peerConnection.current && 
                  (peerConnection.current.iceConnectionState === 'failed' || 
                   peerConnection.current.connectionState === 'failed')) {
                leaveCall();
              }
            }, 2000);
          }
          break;
        case 'disconnected':
          console.warn('⚠️ [WebRTC] ICE connection disconnected');
          // Clear any existing disconnected timeout before setting a new one
          if (iceDisconnectedTimeoutRef.current) {
            clearTimeout(iceDisconnectedTimeoutRef.current);
            iceDisconnectedTimeoutRef.current = null;
          }
          // If disconnected for too long, end call (only if connection state is also not connected)
          // Note: 'disconnected' can be temporary during ICE renegotiation, so we check both states
          iceDisconnectedTimeoutRef.current = setTimeout(() => {
            if (peerConnection.current && 
                peerConnection.current.iceConnectionState === 'disconnected' &&
                peerConnection.current.connectionState !== 'connected' &&
                callAccepted) { // Only end call if it was actually accepted
              console.error('❌ [WebRTC] ICE disconnected too long, ending call');
              console.error('❌ [WebRTC] Connection state:', peerConnection.current.connectionState);
              console.error('❌ [WebRTC] ICE state:', peerConnection.current.iceConnectionState);
              leaveCall();
            }
            iceDisconnectedTimeoutRef.current = null;
          }, 10000); // Increased to 10 seconds to allow for temporary disconnections
          break;
      }
    };

    // Monitor signaling state
    pc.onsignalingstatechange = () => {
      console.log(`📡 [WebRTC] Signaling state: ${pc.signalingState}`);
    };

    // Set connection timeout - end call if not connected within timeout period
    connectionTimeoutRef.current = setTimeout(() => {
      const currentState = pc.connectionState;
      const currentIceState = pc.iceConnectionState;
      
      // End call if not connected (checking state from peerConnection ref to ensure it's current)
      if (peerConnection.current && peerConnection.current.connectionState !== 'connected') {
        console.error('❌ [WebRTC] ========== CONNECTION TIMEOUT ==========');
        console.error(`❌ [WebRTC] Connection state: ${currentState}, ICE state: ${currentIceState}`);
        console.error(`❌ [WebRTC] Timeout after ${WEBRTC_CONFIG.CONNECTION_TIMEOUT}ms`);
        
        // Notify the other user via socket that call timed out
        // Use persistentCallerIdRef as primary source (survives cleanup), then remoteUserIdRef, then call state
        // Use userIdRef instead of user?._id (more reliable, doesn't depend on React state)
        const otherUserId = persistentCallerIdRef.current ||
                           remoteUserIdRef.current || 
                           (call.isReceivingCall ? call.from : call.userToCall) ||
                           call.from ||
                           call.userToCall;
        const currentUserId = userIdRef.current || user?._id;
        if (socket && otherUserId && currentUserId) {
          console.log('📤 [WebRTC] Notifying other user about connection timeout');
          console.log('📤 [WebRTC] Other user ID:', otherUserId, {
            fromPersistentCallerIdRef: !!persistentCallerIdRef.current,
            fromRemoteUserIdRef: !!remoteUserIdRef.current,
            fromCallFrom: !!call.from,
            fromCallUserToCall: !!call.userToCall,
            isReceivingCall: call.isReceivingCall,
            currentUserId,
          });
          socket.emit('cancelCall', {
            conversationId: otherUserId,
            sender: currentUserId,
          });
        } else {
          console.warn('⚠️ [WebRTC] Cannot notify other user about timeout - missing requirements:', {
            hasSocket: !!socket,
            otherUserId,
            currentUserId,
            persistentCallerIdRef: persistentCallerIdRef.current,
            remoteUserIdRef: remoteUserIdRef.current,
            callFrom: call.from,
            callUserToCall: call.userToCall,
          });
        }
        
        // End the call (this will clean up and reset state)
        leaveCall();
        console.error('❌ [WebRTC] Call ended due to connection timeout');
      }
    }, WEBRTC_CONFIG.CONNECTION_TIMEOUT);

    peerConnection.current = pc;
    return pc;
  };

  // Cleanup peer connection with proper resource management
  const cleanupPeer = () => {
    console.log('🧹 [WebRTC] Cleaning up peer connection...');
    
    // Stop InCallManager (audio routing) – must run so mic/speaker are released
    try {
      InCallManager.stop();
      console.log('📞 [WebRTC] InCallManager stopped');
    } catch (e) {
      console.warn('⚠️ [WebRTC] InCallManager.stop error (continuing cleanup):', (e as Error)?.message);
    }
    
    setDisplayConnectedFromPeer(false);
    // Clear timers
    callDurationIntervalRef.current = null;
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (iceDisconnectedTimeoutRef.current) {
      clearTimeout(iceDisconnectedTimeoutRef.current);
      iceDisconnectedTimeoutRef.current = null;
    }
    if (receiverTimeoutRef.current) {
      clearTimeout(receiverTimeoutRef.current);
      receiverTimeoutRef.current = null;
    }
    if (signalWaitTimeoutRef.current) {
      clearTimeout(signalWaitTimeoutRef.current);
      signalWaitTimeoutRef.current = null;
    }
    if (requestSignalTimeoutRef.current) {
      clearTimeout(requestSignalTimeoutRef.current);
      requestSignalTimeoutRef.current = null;
    }
    if (connectionDisconnectedDebounceRef.current) {
      clearTimeout(connectionDisconnectedDebounceRef.current);
      connectionDisconnectedDebounceRef.current = null;
    }
    if (iceDisconnectedDebounceRef.current) {
      clearTimeout(iceDisconnectedDebounceRef.current);
      iceDisconnectedDebounceRef.current = null;
    }
    
    // 2. Peer connection cleanup (react-native-webrtc: removeTrack then close)
    if (peerConnection.current) {
      const pc = peerConnection.current;
      try {
        pc.onicecandidate = null;
        pc.ontrack = null;
        pc.onconnectionstatechange = null;
        pc.oniceconnectionstatechange = null;
        const senders = pc.getSenders();
        senders.forEach(sender => {
          try {
            if (sender.track) pc.removeTrack(sender);
          } catch (_) {}
        });
        pc.getTransceivers?.().forEach((tr: any) => {
          try {
            if (tr.stop && !tr.stopped) tr.stop();
          } catch (_) {}
        });
        pc.close();
      } catch (error) {
        console.error('❌ [WebRTC] Error closing peer connection:', error);
      }
      peerConnection.current = null;
    }
    
    // 3. Stop local stream tracks (must stop on BOTH sides – camera/mic release)
    const local = localStreamRef.current;
    if (local) {
      local.getTracks().forEach(track => {
        track.enabled = false;
        track.stop();
      });
      localStreamRef.current = null;
      setLocalStream(null);
    }
    
    // 4. Stop and cleanup remote stream
    const remote = remoteStreamRef.current;
    if (remote) {
      remote.getTracks().forEach(track => {
        track.enabled = false;
        track.stop();
      });
      remoteStreamRef.current = null;
      setRemoteStream(null);
    }
    mergedRemoteStreamRef.current = null;
    
    // CRITICAL: Release getUserMedia lock so next call can get camera/mic (fixes stuck lock after answer/cancel)
    getUserMediaInProgressRef.current = false;
    lastCallEndedAtRef.current = Date.now(); // Android needs cooldown before camera is released
    // Clear pre-fetched stream (notification flow)
    preFetchAbortedRef.current = true;
    if (preFetchedStreamRef.current) {
      preFetchedStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      preFetchedStreamRef.current = null;
      preFetchedStreamTypeRef.current = null;
    }
    if (preAcquiredStreamRef.current) {
      preAcquiredStreamRef.current.getTracks().forEach(t => { t.enabled = false; t.stop(); });
      preAcquiredStreamRef.current = null;
      preAcquiredStreamTypeRef.current = null;
    }
    // Reset state (persistentCallerIdRef cleared in resetAllCallState / leaveCall)
    remoteUserIdRef.current = null;
    persistentCallerIdRef.current = null;
    pendingIceCandidates.current = [];
    reconnectionAttempts.current = 0;
    callStartTimeRef.current = null;
    setCallDuration(0);
    setConnectionState('new');
    setIceConnectionState('new');
    setIsSpeakerOn(false);
    
    console.log('✅ [WebRTC] Cleanup complete');
  };

  /** FIRM: Single full reset so user can call again after end call, cancel, timeout, or connection lost. */
  const resetAllCallState = useCallback(() => {
    console.log('🔄 [WebRTC] resetAllCallState – full reset so user can call again');
    // 1. Clear all timeouts so none fire after reset
    if (requestSignalTimeoutRef.current) {
      clearTimeout(requestSignalTimeoutRef.current);
      requestSignalTimeoutRef.current = null;
    }
    if (signalWaitTimeoutRef.current) {
      clearTimeout(signalWaitTimeoutRef.current);
      signalWaitTimeoutRef.current = null;
    }
    if (receiverTimeoutRef.current) {
      clearTimeout(receiverTimeoutRef.current);
      receiverTimeoutRef.current = null;
    }
    if (connectionTimeoutRef.current) {
      clearTimeout(connectionTimeoutRef.current);
      connectionTimeoutRef.current = null;
    }
    if (iceDisconnectedTimeoutRef.current) {
      clearTimeout(iceDisconnectedTimeoutRef.current);
      iceDisconnectedTimeoutRef.current = null;
    }
    callDurationIntervalRef.current = null;
    if (connectionDisconnectedDebounceRef.current) {
      clearTimeout(connectionDisconnectedDebounceRef.current);
      connectionDisconnectedDebounceRef.current = null;
    }
    if (iceDisconnectedDebounceRef.current) {
      clearTimeout(iceDisconnectedDebounceRef.current);
      iceDisconnectedDebounceRef.current = null;
    }
    // 2. Full peer/stream cleanup
    cleanupPeer();
    // 3. Clear all call-related refs (firm reset for cancel → new call)
    pendingIceCandidates.current = [];
    pendingAnswerRef.current = null;
    pendingSignalRequestRef.current = null;
    hasRequestedSignalRef.current = null;
    hasReceivedSignalForCallerRef.current = null;
    processingCallUserRef.current = false;
    processingCallCanceledRef.current = false;
    callWasCanceledRef.current = false;
    lastProcessedSignalSdpRef.current = null;
    lastCallSignalReceivedRef.current = null;
    incomingCallFromNotificationCallerIdRef.current = null;
    shouldAutoAnswerRef.current = null;
    activeCallIdRef.current = null;
    isAnsweringRef.current = false;
    remoteUserIdRef.current = null;
    persistentCallerIdRef.current = null;
    lastCanceledCallRef.current = null; // FIRM: clear so new callback/recall is never blocked
    preFetchAbortedRef.current = false; // FIRM: reset for next call's pre-fetch (e.g. off-app answer)
    reconnectionAttempts.current = 0;
    // CRITICAL: Release getUserMedia lock so callback/recall can get camera/mic (fixes "Camera still resetting" after cancel)
    getUserMediaInProgressRef.current = false;
    callUserInProgressRef.current = false;
    lastCallEndedAtRef.current = Date.now(); // Android needs cooldown before camera is released
    // 4. Reset all call state
    setCall({ isReceivingCall: false, from: undefined, userToCall: undefined, name: undefined, signal: undefined, callType: 'audio' });
    setCallEnded(true);
    setCallAccepted(false);
    setIsCalling(false);
    setIncomingCallFromNotificationCallerId(null);
    setCallBusyReason(null);
    setDisplayConnectedFromPeer(false);
    setCallDuration(0);
    setConnectionState('new');
    setIceConnectionState('new');
    clearCallData().catch(() => {});
    console.log('✅ [WebRTC] resetAllCallState – state cleared');
    setTimeout(() => {
      setCallEnded(false);
      processingCallCanceledRef.current = false;
      // 500ms delay so camera/mic can release (Android). No preAcquireStream here – it raced with next callUser.
      console.log('✅ [WebRTC] resetAllCallState – ready for new calls');
    }, 500);
  }, []);

  // Call user
  const callUser = async (userId: string, userName: string, type: 'audio' | 'video') => {
    callUserInProgressRef.current = true;
    try {
      console.log('═══════════════════════════════════════════════════════');
      console.log(`📞 [CallUser] ========== STARTING CALL ==========`);
      
      // CRITICAL: Reset cancel flag for NEW calls
      // This prevents stale pending cancels from interfering with new calls
      callWasCanceledRef.current = false;
      lastCanceledCallRef.current = null; // Clear so we don't block our own new call's echo
      console.log('✅ [CallUser] Reset callWasCanceledRef for new call');
      console.log(`📞 [CallUser] Target: ${userName} (${userId})`);
      console.log(`📞 [CallUser] Type: ${type}`);
      console.log(`📞 [CallUser] Current user: ${user?._id}`);
      
      // CRITICAL: Firm reset for new call (e.g. after cancel → call someone else)
      setCallEnded(false); // Reset callEnded immediately to allow new call
      setCallAccepted(false);
      setIsCalling(false);
      setCall({});
      setCallBusyReason(null);
      processingCallCanceledRef.current = false;
      callWasCanceledRef.current = false;
      persistentCallerIdRef.current = null;
      remoteUserIdRef.current = null;
      processingCallUserRef.current = false;
      lastProcessedSignalSdpRef.current = null;
      hasReceivedSignalForCallerRef.current = null;
      reconnectionAttempts.current = 0;
      // DON'T clear remoteUserIdRef here - it will be set below
      // DON'T clear peerConnection here - it will be created fresh below
      pendingSignalRequestRef.current = null;
      hasRequestedSignalRef.current = null;
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      
      // Cancel any pending media warmup so it doesn't compete for getUserMedia lock
      if (mediaWarmupTimeoutRef.current) {
        clearTimeout(mediaWarmupTimeoutRef.current);
        mediaWarmupTimeoutRef.current = null;
      }
      // Ensure lock is released from any previous call (belt-and-suspenders for callback flow)
      getUserMediaInProgressRef.current = false;

      // Clean up any existing media/peer state BEFORE creating a new one
      const hasStaleMedia = !!peerConnection.current || !!localStream || !!remoteStream || !!preFetchedStreamRef.current;
      if (hasStaleMedia) {
        console.log('🧹 [CallUser] Cleaning up existing call media before creating new one...');
        cleanupPeer();
        await new Promise((r) => setTimeout(r, 500));
      } else {
        const sinceLastEnd = Date.now() - lastCallEndedAtRef.current;
        if (sinceLastEnd < 500 && lastCallEndedAtRef.current > 0) {
          console.log(`📞 [CallUser] Waiting 500ms for previous call to fully close (${Math.round(sinceLastEnd)}ms since end)...`);
          await new Promise((r) => setTimeout(r, 500 - sinceLastEnd));
        }
      }
      
      pendingAnswerRef.current = null;
      console.log('✅ [CallUser] Call state reset - ready for new call');
      
      // Check actual socket connection status (not just if socket exists)
      const socketInstance = socket?.getSocket?.();
      const isConnected = socketInstance?.connected === true || socket?.isSocketConnected?.() === true;
      console.log(`📞 [CallUser] Socket connected: ${isConnected ? 'Yes' : 'No'}`, {
        hasSocket: !!socket,
        hasSocketInstance: !!socketInstance,
        socketConnected: socketInstance?.connected,
        isSocketConnectedFlag: socket?.isSocketConnected?.(),
      });
      
      if (!isConnected) {
        const uid = user?._id || userIdRef.current;
        if (uid && typeof (socket as any)?.connect === 'function') {
          console.log('🔄 [CallUser] Socket disconnected – reconnecting...');
          (socket as any).connect(uid);
          const sock = socket?.getSocket?.();
          if (sock?.connected) {
            console.log('✅ [CallUser] Socket already connected');
          } else if (sock) {
            await new Promise<void>((resolve, reject) => {
              const done = () => { clearTimeout(t); resolve(); };
              const t = setTimeout(() => reject(new Error('Reconnect timeout')), 3000);
              sock.once('connect', done);
            }).catch(() => {});
          }
          const nowConnected = socket?.getSocket?.()?.connected === true;
          if (!nowConnected) {
            throw new Error('Socket not connected. Please wait for connection.');
          }
        } else {
          throw new Error('Socket not connected. Please wait for connection.');
        }
      }
      
      remoteUserIdRef.current = userId;
      setCallType(type);
      setIsCalling(true);
      setCallEnded(false);
      
      console.log(`📞 [CallUser] Step 1: Getting media stream (madechess-style: prefer pre-acquired)...`);
      let stream: MediaStream;
      const preAcquired = preAcquiredStreamRef.current;
      const preAcquiredType = preAcquiredStreamTypeRef.current;
      const preAcquiredValid = preAcquired && preAcquired.getTracks().every((t) => t.readyState === 'live');
      const typeCompatible = preAcquiredType === type || (preAcquiredType === 'video' && type === 'audio');
      if (preAcquiredValid && typeCompatible) {
        stream = preAcquired;
        preAcquiredStreamRef.current = null;
        preAcquiredStreamTypeRef.current = null;
        setLocalStream(stream);
        const media = type === 'video' ? 'video' : 'audio';
        InCallManager.start({ media, auto: type === 'video', ringback: '' });
        setIsSpeakerOn(type === 'video');
        console.log(`✅ [CallUser] Using pre-acquired stream (madechess-style)`);
      } else {
        if (preAcquired && !preAcquiredValid) {
          preAcquired.getTracks().forEach((t) => t.stop());
          preAcquiredStreamRef.current = null;
          preAcquiredStreamTypeRef.current = null;
        }
        stream = await getMediaStream(type, true);
      }
      console.log(`✅ [CallUser] Media stream obtained:`, {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });
      
      console.log(`📞 [CallUser] Step 2: Creating peer connection...`);
      const pc = createPeerConnection(stream);
      console.log(`✅ [CallUser] Peer connection created:`, {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
      });
      console.log('📞 [CallUser] CALLBACK_CHECK: Fresh PC created', {
        signalingState: pc.signalingState,
        note: 'Should be "stable" for new offer',
      });
      
      // CRITICAL: If there's a pending answer (race condition - answer arrived before peer connection was created)
      // Process it now that the peer connection is ready
      if (pendingAnswerRef.current && peerConnection.current) {
        console.log('📞 [CallUser] Processing pending answer that arrived before peer connection was ready...');
        try {
          // CRITICAL: Check signaling state before setting remote description
          const currentState = peerConnection.current.signalingState;
          if (currentState !== 'have-local-offer') {
            console.warn('⚠️ [CallUser] Cannot set pending answer - wrong signaling state:', currentState);
            console.warn('⚠️ [CallUser] Expected "have-local-offer" but got:', currentState);
            pendingAnswerRef.current = null; // Clear the stale answer
          } else {
            await peerConnection.current.setRemoteDescription(pendingAnswerRef.current);
            console.log('✅ [CallUser] Pending answer processed successfully');
            setCallAccepted(true);
            setIsCalling(false);
            pendingAnswerRef.current = null; // Clear after processing
          }
        } catch (error: any) {
          console.error('❌ [CallUser] Error processing pending answer:', error);
          pendingAnswerRef.current = null; // Clear on error to prevent retry loops
        }
      }
      
      console.log(`📞 [CallUser] Step 3: Creating offer...`);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: type === 'video',
      });
      console.log(`✅ [CallUser] Offer created:`, {
        type: offer.type,
        sdpLength: offer.sdp?.length || 0,
      });
      
      console.log(`📞 [CallUser] Step 4: Setting local description...`);
      await pc.setLocalDescription(offer);
      console.log(`✅ [CallUser] Local description set:`, {
        signalingState: pc.signalingState,
      });
      
      console.log(`📞 [CallUser] Step 5: Emitting socket event...`);
      const callId = `${Date.now()}-${user?._id}`;
      activeCallIdRef.current = callId;
      const callData = {
        userToCall: userId,
        signalData: offer,
        from: user?._id,
        name: user?.name || user?.username,
        callType: type,
        callId,
      };
      console.log(`📤 [CallUser] Emitting callUser:`, {
        userToCall: callData.userToCall,
        from: callData.from,
        name: callData.name,
        callType: callData.callType,
        hasSignal: !!callData.signalData,
      });
      console.log('📤 [CallUser] CALLBACK_SCENARIO: B is calling A back', {
        caller: callData.from,
        receiver: callData.userToCall,
        note: 'If A was off-app in previous call, backend must have cleared inCall for both',
      });
      socket.emit('callUser', callData);
      console.log('✅ [CallUser] Socket event emitted with offer');
      
      // Set call state with all necessary info for outgoing calls
      const callState = { 
        isReceivingCall: false, 
        userToCall: userId,
        from: user?._id,
        name: userName,
        signal: offer,
        callType: type,
      };
      setCall(callState);
      console.log(`✅ [CallUser] Call state set:`, callState);
      console.log(`✅ [CallUser] ========== CALL INITIATED SUCCESSFULLY ==========`);
      console.log('═══════════════════════════════════════════════════════');
    } catch (error: any) {
      console.error('❌ [CallUser] ========== ERROR ==========');
      console.error('❌ [CallUser] Error:', error);
      console.error('❌ [CallUser] Error message:', error?.message);
      console.error('❌ [CallUser] Error stack:', error?.stack);
      console.error('═══════════════════════════════════════════════════════');
      cleanupPeer();
      setIsCalling(false);
      remoteUserIdRef.current = null;
      throw error;
    } finally {
      callUserInProgressRef.current = false;
    }
  };

  // Answer call
  // Accept optional signal and from parameters to avoid race condition when called immediately after setCall()
  const answerCall = async (signalOverride?: any, fromOverride?: string) => {
    // CRITICAL: Prevent duplicate calls - check state BEFORE any async operations
    if (callAccepted || isAnsweringRef.current) {
      console.warn('⚠️ [AnswerCall] Call already accepted or answering in progress - ignoring duplicate answer attempt', {
        callAccepted,
        isAnswering: isAnsweringRef.current,
      });
      return;
    }
    
    // Set flag immediately to prevent duplicates
    isAnsweringRef.current = true;
    
    // FIRM: Reset connection display state so second (and later) answers behave like the first – no stale "Connected", no leftover timer
    setDisplayConnectedFromPeer(false);
    setConnectionState('new');
    setIceConnectionState('new');
    callDurationIntervalRef.current = null;
    callStartTimeRef.current = null;
    setCallDuration(0);
    
    try {
      // Cleanup existing peer connection if it exists (but check state first)
      if (peerConnection.current && peerConnection.current.connectionState !== 'closed') {
        console.warn('⚠️ [AnswerCall] Peer connection exists with state:', peerConnection.current.connectionState, '- cleaning up first');
        cleanupPeer();
        // Wait a bit for cleanup to complete
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Use signal and from from parameters if provided (for race condition), otherwise use call state
      const signalToUse = signalOverride || call.signal;
      const fromToUse = fromOverride || call.from || remoteUserIdRef.current || null;
      
      console.log('═══════════════════════════════════════════════════════');
      console.log(`📞 [AnswerCall] ========== ANSWERING CALL ==========`);
      console.log(`📞 [AnswerCall] Call state:`, {
        from: fromToUse,
        name: call.name,
        callType: call.callType,
        hasSignal: !!signalToUse,
        signalSource: signalOverride ? 'parameter' : 'call.signal',
        fromSource: fromOverride ? 'parameter' : (call.from ? 'call.from' : 'remoteUserIdRef'),
      });
      
      // CRITICAL: Check if call was already canceled before proceeding
      if (callWasCanceledRef.current) {
        console.log('📴 [AnswerCall] Call already canceled – aborting answer (no error)');
        isAnsweringRef.current = false;
        cleanupPeer();
        setCallAccepted(false);
        return;
      }
      
      // CRITICAL: Set remoteUserIdRef BEFORE creating peer connection
      // This ensures ICE candidates can be sent immediately when generated
      remoteUserIdRef.current = fromToUse;
      // CRITICAL: Store caller ID persistently for timeout handling (survives cleanup)
      if (fromToUse) {
        persistentCallerIdRef.current = fromToUse;
      }
      setCallAccepted(true); // Set this FIRST to prevent duplicate calls
      setIsCalling(false);
      setCallEnded(false);
      
      // CRITICAL: Dismiss FCM notification when answering (works even if IncomingCallActivity is closed)
      try {
        const { NativeModules } = require('react-native');
        const { CallDataModule } = NativeModules;
        if (CallDataModule && CallDataModule.dismissCallNotification) {
          await CallDataModule.dismissCallNotification();
          console.log('✅ [AnswerCall] Notification dismissed via native module');
        }
      } catch (error) {
        console.warn('⚠️ [AnswerCall] Could not dismiss notification:', error);
        // Non-fatal - notification will be dismissed when call ends or by IncomingCallActivity
      }
      
      console.log(`📞 [AnswerCall] Step 1: Getting media stream (madechess-style: prefer pre-fetched → pre-acquired → getMediaStream)...`);
      let stream: MediaStream;
      const callTypeForStream = call.callType || 'video';
      if (preFetchedStreamRef.current && preFetchedStreamTypeRef.current === callTypeForStream) {
        const prefetched = preFetchedStreamRef.current;
        preFetchedStreamRef.current = null;
        preFetchedStreamTypeRef.current = null;
        const hasVideo = prefetched.getVideoTracks().length > 0;
        const needsVideo = callTypeForStream === 'video';
        if (needsVideo && !hasVideo) {
          prefetched.getTracks().forEach((t) => t.stop());
          clearPreFetchedStream();
          stream = await getMediaStream(callTypeForStream, true);
        } else {
          stream = prefetched;
          setLocalStream(stream);
          const media = callTypeForStream === 'video' ? 'video' : 'audio';
          InCallManager.start({ media, auto: callTypeForStream === 'video', ringback: '' });
          setIsSpeakerOn(callTypeForStream === 'video');
          console.log(`✅ [AnswerCall] Used pre-fetched stream (notification flow):`, {
            audioTracks: stream.getAudioTracks().length,
            videoTracks: stream.getVideoTracks().length,
          });
        }
      } else if (preAcquiredStreamRef.current) {
        preFetchAbortedRef.current = true;
        clearPreFetchedStream();
        const preAcquired = preAcquiredStreamRef.current;
        const preAcquiredType = preAcquiredStreamTypeRef.current;
        const preAcquiredValid = preAcquired.getTracks().every((t) => t.readyState === 'live');
        const typeCompatible = preAcquiredType === callTypeForStream || (preAcquiredType === 'video' && callTypeForStream === 'audio');
        if (preAcquiredValid && typeCompatible) {
          stream = preAcquired;
          preAcquiredStreamRef.current = null;
          preAcquiredStreamTypeRef.current = null;
          setLocalStream(stream);
          const media = callTypeForStream === 'video' ? 'video' : 'audio';
          InCallManager.start({ media, auto: callTypeForStream === 'video', ringback: '' });
          setIsSpeakerOn(callTypeForStream === 'video');
          console.log(`✅ [AnswerCall] Used pre-acquired stream (madechess-style, in-app):`, {
            audioTracks: stream.getAudioTracks().length,
            videoTracks: stream.getVideoTracks().length,
          });
        } else {
          if (preAcquired) {
            preAcquired.getTracks().forEach((t) => t.stop());
            preAcquiredStreamRef.current = null;
            preAcquiredStreamTypeRef.current = null;
          }
          await new Promise((r) => setTimeout(r, 350));
          stream = await getMediaStream(callTypeForStream, true);
          console.log(`✅ [AnswerCall] Media stream obtained:`, {
            audioTracks: stream.getAudioTracks().length,
            videoTracks: stream.getVideoTracks().length,
          });
        }
        preFetchAbortedRef.current = false;
      } else {
        preFetchAbortedRef.current = true;
        clearPreFetchedStream();
        await new Promise((r) => setTimeout(r, 350));
        stream = await getMediaStream(callTypeForStream, true);
        preFetchAbortedRef.current = false;
        console.log(`✅ [AnswerCall] Media stream obtained:`, {
          audioTracks: stream.getAudioTracks().length,
          videoTracks: stream.getVideoTracks().length,
        });
      }
      
      // CRITICAL: Double-check call wasn't canceled while getting media stream
      if (callWasCanceledRef.current) {
        console.log('📴 [AnswerCall] Call canceled while getting media – aborting (no error)');
        isAnsweringRef.current = false;
        cleanupPeer();
        setCallAccepted(false);
        return;
      }
      
      console.log(`📞 [AnswerCall] Step 2: Creating peer connection...`);
      // Clear receiver timeout since we're now answering
      if (receiverTimeoutRef.current) {
        clearTimeout(receiverTimeoutRef.current);
        receiverTimeoutRef.current = null;
        console.log('✅ [AnswerCall] Receiver timeout cleared - call is being answered');
      }
      // CRITICAL: Clear signal-wait timeout so "no signal within 15s" never fires after we've answered
      if (signalWaitTimeoutRef.current) {
        clearTimeout(signalWaitTimeoutRef.current);
        signalWaitTimeoutRef.current = null;
        console.log('✅ [AnswerCall] Signal-wait timeout cleared - call answered, no cancel on timeout');
      }
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      if (fromToUse) hasReceivedSignalForCallerRef.current = fromToUse; // Ensure timeout callback sees we got signal
      const pc = createPeerConnection(stream);
      console.log(`✅ [AnswerCall] Peer connection created`);
      
      if (signalToUse) {
        console.log(`📞 [AnswerCall] Step 3: Setting remote description (offer)...`);
        await pc.setRemoteDescription(new RTCSessionDescription(signalToUse));
        console.log(`✅ [AnswerCall] Remote description set:`, {
          signalingState: pc.signalingState,
        });
        
        // Process any queued ICE candidates
        if (pendingIceCandidates.current.length > 0) {
          console.log(`📦 [AnswerCall] Processing ${pendingIceCandidates.current.length} queued ICE candidates...`);
          for (const candidate of pendingIceCandidates.current) {
            try {
              await pc.addIceCandidate(candidate);
              console.log('✅ [AnswerCall] Queued ICE candidate added');
            } catch (error: any) {
              // Some errors are non-fatal (e.g., duplicate candidates)
              if (error.message && !error.message.includes('already have')) {
                console.error('❌ [AnswerCall] Error adding queued ICE candidate:', error);
              }
            }
          }
          pendingIceCandidates.current = [];
        }
        
        console.log(`📞 [AnswerCall] Step 4: Creating answer...`);
        const answer = await pc.createAnswer();
        console.log(`✅ [AnswerCall] Answer created:`, {
          type: answer.type,
          sdpLength: answer.sdp?.length || 0,
        });
        
        console.log(`📞 [AnswerCall] Step 5: Setting local description (answer)...`);
        await pc.setLocalDescription(answer);
        console.log(`✅ [AnswerCall] Local description set:`, {
          signalingState: pc.signalingState,
        });
        
        if (socket && fromToUse) {
          console.log(`📞 [AnswerCall] Step 6: Emitting answerCall socket event...`);
          const answerData: { signal: RTCSessionDescription; to: string; callId?: string } = {
            signal: answer,
            to: fromToUse,
          };
          if (activeCallIdRef.current) answerData.callId = activeCallIdRef.current;
          console.log(`📤 [AnswerCall] Emitting answerCall:`, {
            to: answerData.to,
            hasSignal: !!answerData.signal,
          });
          socket.emit('answerCall', answerData);
          console.log('✅ [AnswerCall] Socket event emitted with answer');
        } else {
          console.error('❌ [AnswerCall] Socket or from missing:', {
            hasSocket: !!socket,
            fromToUse: fromToUse,
            callFrom: call.from,
            remoteUserIdRef: remoteUserIdRef.current,
          });
        }
      } else {
        console.error('❌ [AnswerCall] No signal in call state!');
        throw new Error('No call signal available');
      }
      
      console.log(`✅ [AnswerCall] ========== CALL ANSWERED SUCCESSFULLY ==========`);
      console.log('═══════════════════════════════════════════════════════');
      // Reset flag on success
      isAnsweringRef.current = false;
    } catch (error: any) {
      const canceledMsg = error?.message && (
        error.message.includes('Call was canceled') ||
        error.message.includes('call was canceled')
      );
      if (!canceledMsg) {
        console.error('❌ [AnswerCall] ========== ERROR ==========');
        console.error('❌ [AnswerCall] Error:', error);
        console.error('❌ [AnswerCall] Error message:', error?.message);
        console.error('❌ [AnswerCall] Error stack:', error?.stack);
        console.error('═══════════════════════════════════════════════════════');
      }
      // Reset flag on error so we can retry (unless it's a closed state error)
      isAnsweringRef.current = false;
      if (error?.message?.includes('closed') || error?.message?.includes('wrong state')) {
        setCallAccepted(false);
      }
      cleanupPeer();
      setCallAccepted(false);
      remoteUserIdRef.current = null;
      if (!canceledMsg) throw error;
    }
  };

  // Leave call
  const leaveCall = () => {
    console.log('📴 [LeaveCall] Leaving call...');
    
    // Capture otherUserId BEFORE cleanupPeer (cleanupPeer clears refs)
    // Determine other user ID - prioritize persistentCallerIdRef (survives cleanup), then isCalling state and remoteUserIdRef
    // If we're calling (outgoing), use call.userToCall or remoteUserIdRef
    // If we're receiving (incoming), use call.from or persistentCallerIdRef
    // persistentCallerIdRef is the most reliable as it persists even after cleanup
    let otherUserId: string | null | undefined = null;
    
    // CRITICAL: Use persistentCallerIdRef first (survives cleanup, most reliable for timeout scenarios)
    if (persistentCallerIdRef.current) {
      otherUserId = persistentCallerIdRef.current;
    } else if (isCalling && remoteUserIdRef.current) {
      // We're making an outgoing call - use remoteUserIdRef
      otherUserId = remoteUserIdRef.current;
    } else if (isCalling && call.userToCall) {
      // We're making an outgoing call - use call.userToCall
      otherUserId = call.userToCall;
    } else if (call.isReceivingCall && call.from) {
      // We're receiving an incoming call - use call.from
      otherUserId = call.from;
    } else if (remoteUserIdRef.current) {
      // Fallback to remoteUserIdRef if available
      otherUserId = remoteUserIdRef.current;
    } else if (call.userToCall) {
      // Fallback to call.userToCall (outgoing: the user we're calling)
      otherUserId = call.userToCall;
    } else if (call.isReceivingCall && call.from) {
      // Only use call.from when we're the receiver; never when caller (call.from would be self)
      otherUserId = call.from;
    }
    
    // CRITICAL: Release mic/camera immediately – ensures devices are freed for next call
    // Must run before resetAllCallState so tracks are stopped while we still have stream refs
    cleanupPeer();
    
    // CRITICAL: Always emit cancelCall if there's an active call attempt
    // Check: isCalling, callAccepted, isReceivingCall, OR if remoteUserIdRef has a value (call was initiated)
    // This ensures the other user is notified when we cancel, even if call state is partial or being cleared
    const hasActiveCall = callAccepted || isCalling || call.isReceivingCall || !!remoteUserIdRef.current || !!otherUserId;
    
    // IMPORTANT: Emit cancelCall if we have any indication of an active call
    // This includes having otherUserId even if state flags are false (might be in cleanup transition)
    // Use userIdRef instead of user?._id for more reliability
    const currentUserId = userIdRef.current || user?._id;
    if (socket && otherUserId && currentUserId) {
      const cancelData: { conversationId: string; sender: string; callId?: string } = {
        conversationId: otherUserId,
        sender: currentUserId,
      };
      if (activeCallIdRef.current) cancelData.callId = activeCallIdRef.current;
      console.log('📴 [LeaveCall] Emitting cancelCall event:', cancelData);
      console.log('📴 [LeaveCall] Socket connected:', socket?.isSocketConnected?.());
      console.log('📴 [LeaveCall] Call state:', {
        callAccepted,
        isCalling,
        isReceivingCall: call.isReceivingCall,
        callFrom: call.from,
        callUserToCall: call.userToCall,
        remoteUserIdRef: remoteUserIdRef.current,
        otherUserId, // Log the calculated otherUserId
      });
      
      if (socket.isSocketConnected()) {
        socket.emit('cancelCall', cancelData);
        console.log('✅ [LeaveCall] cancelCall event emitted to backend');
      } else {
        // FIRM: Fallback to HTTP when socket disconnected (e.g. off-app answer → cancel during reconnect)
        // Ensures backend clears inCall/activeCall so recall works
        console.warn('⚠️ [LeaveCall] Socket not connected - using HTTP cancel fallback');
        apiService
          .post('/api/call/cancel', { conversationId: otherUserId, sender: currentUserId })
          .then(() => console.log('✅ [LeaveCall] HTTP cancelCall succeeded'))
          .catch((err: unknown) =>
            console.error('❌ [LeaveCall] HTTP cancelCall failed:', (err as { response?: unknown })?.response ?? err)
          );
      }
    } else {
      console.warn('⚠️ [LeaveCall] Cannot emit cancelCall - missing requirements:', {
        hasSocket: !!socket,
        socketConnected: socket?.isSocketConnected?.(),
        otherUserId,
        currentUserId,
        userIdFromRef: userIdRef.current,
        userIdFromState: user?._id,
        hasActiveCall,
        callAccepted,
        isCalling,
        isReceivingCall: call.isReceivingCall,
        remoteUserIdRef: remoteUserIdRef.current,
        persistentCallerIdRef: persistentCallerIdRef.current,
      });
    }
    
    // Native IncomingCallActivity handles notification hiding
    
    // FIRM: Single full reset so user can call again (end call, connection lost, timer – same path)
    resetAllCallState();
  };

  // Toggle mute
  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  // Toggle camera
  const toggleCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsCameraOff(!isCameraOff);
    }
  };

  // Switch camera (front/back)
  const switchCamera = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        // @ts-ignore
        track._switchCamera();
      });
    }
  };

  // Toggle speaker (earpiece <-> speaker)
  const toggleSpeaker = () => {
    const newSpeakerState = !isSpeakerOn;
    setIsSpeakerOn(newSpeakerState);
    
    try {
      if (newSpeakerState) {
        // Switch to speaker
        InCallManager.setForceSpeakerphoneOn(true);
        InCallManager.setSpeakerphoneOn(true);
        console.log('📢 [WebRTC] Speaker ON');
      } else {
        // Switch to earpiece
        InCallManager.setForceSpeakerphoneOn(false);
        InCallManager.setSpeakerphoneOn(false);
        console.log('📱 [WebRTC] Earpiece ON (Speaker OFF)');
      }
    } catch (error) {
      console.error('❌ [WebRTC] Error toggling speaker:', error);
    }
  };

  // Set incoming call state from notification (when user answers from income library)
  // Wrapped in useCallback to prevent CallScreen useEffect from re-running
  const setIncomingCallFromNotification = useCallback((callerId: string, callerName: string, callType: 'audio' | 'video', shouldAutoAnswer: boolean = false) => {
    console.log('📞 [NotificationCall] ========== SETUP CALL FROM NOTIFICATION ==========');
    console.log('📞 [NotificationCall] Caller:', callerName, '(', callerId, ')');
    console.log('📞 [NotificationCall] Call type:', callType);
    console.log('📞 [NotificationCall] Should auto-answer:', shouldAutoAnswer);
    
    // CRITICAL: Reset any previous call state before setting up new call
    // This ensures clean state for the second call after a decline
    setCallEnded(false);
    setCallAccepted(false);
    setIsCalling(false);
    callWasCanceledRef.current = false; // Reset cancellation flag for new call
    processingCallUserRef.current = false; // Reset processing flag
    processingCallCanceledRef.current = false; // Reset cancel processing flag
    isAnsweringRef.current = false; // Reset answering flag
    hasReceivedSignalForCallerRef.current = null; // P0: Reset so retry timeout can check accurately
    
    // CRITICAL: Store caller ID persistently for timeout handling
    persistentCallerIdRef.current = callerId;
    
    // Check if we've already requested signal for this caller recently (within last 5 seconds)
    // Do this FIRST to prevent duplicate processing
    const now = Date.now();
    const alreadyRequestedRecently =
      hasRequestedSignalRef.current?.callerId === callerId &&
      (now - (hasRequestedSignalRef.current?.timestamp ?? 0)) < 5000;
    if (alreadyRequestedRecently) {
      console.log('⚠️ [NotificationCall] Already requested signal for this caller recently - skipping emit');
      // Still set pendingSignalRequestRef so "after connect" effect can send if socket wasn't ready before
    } else {
      // Clear previous signal request if it was for a different caller
      if (hasRequestedSignalRef.current && hasRequestedSignalRef.current.callerId !== callerId) {
        console.log('🔄 [NotificationCall] Previous signal request was for different caller - clearing');
        hasRequestedSignalRef.current = null;
        pendingSignalRequestRef.current = null;
      }
    }
    
    if (shouldAutoAnswer) {
      shouldAutoAnswerRef.current = callerId;
      incomingCallFromNotificationCallerIdRef.current = callerId;
      setIncomingCallFromNotificationCallerId(callerId); // So AppNavigator socket effect uses notification params (no Answer/Decline UI)
      console.log('✅ [NotificationCall] Marked for auto-answer:', callerId);
      // Pre-fetch media stream now so answer is faster when signal arrives
      preFetchMediaStreamForAnswer(callType);
    }
    
    pendingIceCandidates.current = [];
    
    setCall({
      isReceivingCall: true,
      from: callerId,
      userToCall: user?._id || '',
      name: callerName,
      signal: null,
      callType: callType,
    });
    setCallType(callType);
    
    // Request call signal from backend (only once, not repeatedly)
    // Cancel any existing timeout first
    if (requestSignalTimeoutRef.current) {
      clearTimeout(requestSignalTimeoutRef.current);
      requestSignalTimeoutRef.current = null;
    }
    
    const socketInstance = socket?.getSocket?.();
    const isConnected = socketInstance?.connected === true || socket?.isSocketConnected?.() === true;
    
    const currentUserId = userIdRef.current || user?._id;
    if (isConnected && currentUserId) {
      // Emit request only once
      console.log('📡 [NotificationCall] ✅ Socket connected! Requesting call signal...');
      try {
        socket.emit('requestCallSignal', {
          callerId: callerId,
          receiverId: currentUserId,
        });
        // Mark that we've requested signal for this caller
        hasRequestedSignalRef.current = { callerId, timestamp: now };
        pendingSignalRequestRef.current = { callerId, receiverId: currentUserId };
        console.log('✅ [NotificationCall] Signal request sent - waiting for response via callUser event');
        console.log('✅ [NotificationCall] Request details:', {
          callerId,
          receiverId: currentUserId,
          timestamp: now,
        });
        
        // CRITICAL: Set timeout to retry signal request if no response within 5 seconds
        // P0: Use hasReceivedSignalForCallerRef (not call.signal) - avoids stale closure
        requestSignalTimeoutRef.current = setTimeout(() => {
          const stillPending = pendingSignalRequestRef.current?.callerId === callerId;
          const noSignalYet = hasReceivedSignalForCallerRef.current !== callerId;
          // Skip retry if we're already in a call (answered/connected)
          const pc = peerConnection.current;
          const alreadyInCall = pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed';
          if (stillPending && noSignalYet && !alreadyInCall && socket?.isSocketConnected?.()) {
            console.warn('⚠️ [NotificationCall] Signal request timeout - retrying...');
            socket.emit('requestCallSignal', { callerId, receiverId: currentUserId });
            console.log('🔄 [NotificationCall] Signal request retried');
          }
          requestSignalTimeoutRef.current = null;
        }, 5000);
      } catch (error) {
        console.error('❌ [NotificationCall] Error emitting requestCallSignal:', error);
        // Store as pending if socket not ready
        if (user) {
          pendingSignalRequestRef.current = { callerId, receiverId: user._id };
        }
      }
    } else {
      // Socket not connected yet - always store as pending so "after connect" effect will send (fixes: decline then answer again)
      if (user) {
        pendingSignalRequestRef.current = { callerId, receiverId: user._id };
        console.log('⏳ [NotificationCall] Socket not connected - will request when connected');
      }
    }
    // FIRM: Signal-wait timeout – if no signal within 15s, end call and notify caller (both sides disabled)
    const SIGNAL_WAIT_MS = 15000;
    if (signalWaitTimeoutRef.current) {
      clearTimeout(signalWaitTimeoutRef.current);
      signalWaitTimeoutRef.current = null;
    }
    signalWaitTimeoutRef.current = setTimeout(() => {
      signalWaitTimeoutRef.current = null;
      const stillWaiting = hasReceivedSignalForCallerRef.current !== callerId && pendingSignalRequestRef.current?.callerId === callerId;
      if (!stillWaiting) return;
      // Don't cancel if peer connection is already in progress (call answered and connecting/connected)
      const pc = peerConnection.current;
      const pcActive = pc && pc.connectionState !== 'closed' && pc.connectionState !== 'failed';
      if (pcActive) {
        console.log('✅ [NotificationCall] Signal-wait timeout skipped – call already in progress');
        return;
      }
      console.warn('⚠️ [NotificationCall] Signal wait timeout – no signal received, ending call and notifying caller');
      const uid = userIdRef.current || user?._id;
      if (socket?.isSocketConnected?.() && uid) {
        socket.emit('cancelCall', { conversationId: callerId, sender: uid });
        console.log('📤 [NotificationCall] cancelCall sent to caller (signal timeout)');
      }
      // FIRM: Same full reset so user can call again (timer ended → clean state)
      resetAllCallState();
    }, SIGNAL_WAIT_MS);
  }, [socket, user]);

  const requestCallSignalForCaller = useCallback((callerId: string) => {
    const uid = userIdRef.current || user?._id;
    const connected = socket?.getSocket?.()?.connected === true || socket?.isSocketConnected?.();
    if (!connected || !uid) {
      console.log('📡 [requestCallSignalForCaller] Socket not connected or no user – skip');
      return;
    }
    console.log('📡 [requestCallSignalForCaller] Requesting signal for caller:', callerId);
    socket.emit('requestCallSignal', { callerId, receiverId: uid });
    hasRequestedSignalRef.current = { callerId, timestamp: Date.now() };
    if (!pendingSignalRequestRef.current) {
      pendingSignalRequestRef.current = { callerId, receiverId: uid };
    }
  }, [socket, user]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) {
      console.log('⚠️ [WebRTC] Socket not available, skipping listener setup');
      return;
    }

    console.log('🔌 [WebRTC] ========== SETTING UP SOCKET LISTENERS ==========');
    console.log('🔌 [WebRTC] Socket available:', !!socket);
    console.log('🔌 [WebRTC] User ID:', user?._id);
    
    // CRITICAL: Remove all existing listeners first to prevent duplicates
    socket.off('callUser');
    socket.off('callAccepted');
    socket.off('iceCandidate');
    socket.off('CallCanceled');
    socket.off('callBusyError');
    socket.off('callConnected');
    
    // Connect + requestSignal handled by addConnectListener (runs on every connect, including reconnect)
    
    // Incoming call
    console.log('🔔 [WebRTC] Registering callUser socket listener...');
    socket.on('callUser', async (data: any) => {
      // CRITICAL: Prevent duplicate processing - check ref first
      if (processingCallUserRef.current) {
        console.log('⚠️ [IncomingCall] Already processing callUser event - ignoring duplicate');
        return;
      }
      
      // FIRM: If we have stale call state (isReceivingCall but no active peer), clear it BEFORE processing new call
      // This handles: User B had stale state → User A calls again → clear stale state → process new call
      // CRITICAL: Also check if this is a NEW call from a DIFFERENT caller (not just stale state from same caller)
      const isNewCallFromDifferentCaller = call.isReceivingCall && call.from && call.from !== data.from;
      const hasStaleState = call.isReceivingCall && !callAccepted && !isCalling && 
          (!peerConnection.current || peerConnection.current.connectionState === 'closed' || peerConnection.current.connectionState === 'failed');
      // CRITICAL: Skip stale clear when this is the expected call from notification flow (Answer on native UI)
      // We set up from notification, requested signal – this callUser with signal IS the response, not stale
      const isExpectedNotificationCall = shouldAutoAnswerRef.current === data.from && !!data.signal;
      
      if (!isExpectedNotificationCall && (hasStaleState || isNewCallFromDifferentCaller)) {
        console.warn('⚠️ [IncomingCall] Detected stale call state - cleaning up before processing new call', {
          hasStaleState,
          isNewCallFromDifferentCaller,
          oldCaller: call.from,
          newCaller: data.from,
        });
        justClearedStaleStateRef.current = true;
        cleanupPeer();
        await new Promise((r) => setTimeout(r, 300));
        
        setCall({
          isReceivingCall: false,
          from: undefined,
          userToCall: undefined,
          name: undefined,
          signal: undefined,
          callType: 'audio',
        });
        setPendingCancel(false); // Allow navigation for new call after decline
        setCallEnded(false); // Reset immediately so new call can proceed
        setCallAccepted(false);
        setIsCalling(false);
        remoteUserIdRef.current = null;
        persistentCallerIdRef.current = null;
        processingCallUserRef.current = false;
        processingCallCanceledRef.current = false;
        callWasCanceledRef.current = false;
        isAnsweringRef.current = false;
        hasReceivedSignalForCallerRef.current = null;
        // CRITICAL: Clear SDP dedupe ref - this prevents "duplicate signal" check from blocking new call
        lastProcessedSignalSdpRef.current = null;
        pendingSignalRequestRef.current = null;
        hasRequestedSignalRef.current = null;
        pendingAnswerRef.current = null;
        pendingIceCandidates.current = [];
        if (receiverTimeoutRef.current) {
          clearTimeout(receiverTimeoutRef.current);
          receiverTimeoutRef.current = null;
        }
        if (signalWaitTimeoutRef.current) {
          clearTimeout(signalWaitTimeoutRef.current);
          signalWaitTimeoutRef.current = null;
        }
        if (requestSignalTimeoutRef.current) {
          clearTimeout(requestSignalTimeoutRef.current);
          requestSignalTimeoutRef.current = null;
        }
        console.log('✅ [IncomingCall] Stale state cleared - ready to process new call');
      }
      
      // CRITICAL: Only ignore stale callUser (same callId, very recent) – never block legitimate callbacks
      const canceled = lastCanceledCallRef.current;
      if (canceled) {
        const age = Date.now() - canceled.at;
        const sameCallId = data.callId && canceled.callId && data.callId === canceled.callId;
        if (sameCallId && age < 2000) {
          console.log('⚠️ [IncomingCall] Ignoring stale callUser – same call was canceled < 2s ago', { age, callId: data.callId });
          return;
        }
        if (age >= 2000) lastCanceledCallRef.current = null; // Expire after 2s – allow callbacks
      }
      
      // CRITICAL: Ignore if this is our own call being echoed back from the server
      // We can't receive calls from ourselves - if data.from matches our ID, it's always our echo
      // Use remoteUserIdRef to check if this is our outgoing call (more reliable than isCalling state)
      const fromMatchesOurId = data.from === userIdRef.current || (user?._id && data.from === user._id);
      
      // Check if this is our outgoing call by comparing remoteUserIdRef with the target
      // remoteUserIdRef is set immediately in callUser, so it's reliable even if state hasn't updated
      const isOurOutgoingCall = remoteUserIdRef.current === data.userToCall;
      
      // DEBUG: Log echo check details BEFORE processing
      console.log('🔍 [IncomingCall] Echo check:', {
        'data.from': data.from,
        'userIdRef.current': userIdRef.current,
        'user?._id': user?._id,
        'fromMatchesOurId': fromMatchesOurId,
        'isCalling': isCalling,
        'callAccepted': callAccepted,
        'remoteUserIdRef.current': remoteUserIdRef.current,
        'data.userToCall': data.userToCall,
        'isOurOutgoingCall': isOurOutgoingCall,
      });
      
      // CRITICAL: Clear signal request retry timeout as soon as we receive the signal
      // Prevents "Signal request timeout - retrying" from firing after call connects
      if (data.signal && requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      
      // CRITICAL: If the sender is us, it's always our echo (we can't receive calls from ourselves)
      // But we need to be smart: if we just initiated a call to this user, it's definitely our echo
      // Use remoteUserIdRef to check (set synchronously, more reliable than async React state)
      if (fromMatchesOurId) {
        // This is from us - check if it matches our current outgoing call
        if (isOurOutgoingCall) {
          // This is our own call echo - definitely ignore it
          console.log('⚠️ [IncomingCall] Ignoring - this is our own call echo (from matches our ID and target matches remoteUserIdRef)');
          return;
        }
        
        // If it's from us but target doesn't match, it might be a stale signal from a previous call
        // Still ignore it to prevent processing our own calls as incoming
        console.log('⚠️ [IncomingCall] Ignoring - this is our own call echo (stale signal, target doesn\'t match current call)');
        return;
      }
      
      // Prevent duplicate processing - if we're already receiving this exact call AND we have the signal, ignore.
      // CRITICAL: When coming from notification we set isReceivingCall+from but signal=null, then request signal.
      // The callUser event that delivers the signal must be processed – do NOT ignore when we're waiting for signal.
      // FIRM: Use ref to check if we just cleared stale state (React state updates are async)
      const justClearedStaleState = justClearedStaleStateRef.current;
      const sameCallNoSignalYet = call.isReceivingCall && call.from === data.from && !call.signal && hasReceivedSignalForCallerRef.current !== data.from;
      if (call.isReceivingCall && call.from === data.from && !sameCallNoSignalYet && !justClearedStaleState) {
        console.log('⚠️ [IncomingCall] Ignoring duplicate callUser event for same call (already have signal)');
        return;
      }
      
      // Check if this is the exact same signal we've already processed
      // FIRM: Skip SDP dedupe check if we just cleared stale state (allows re-sent signal after reconnect)
      if (data.signal && data.signal.sdp && !justClearedStaleState) {
        const signalSdp = data.signal.sdp;
        if (lastProcessedSignalSdpRef.current === signalSdp) {
          console.log('⚠️ [IncomingCall] Ignoring duplicate signal - same SDP already processed');
          return;
        }
      }
      
          // CRITICAL: Don't reset flag here - we need it for auto-answer check below
          // The flag will be reset AFTER auto-answer check to prevent incorrect auto-answer
      
      // Also check if we're already answering this call
      if (callAccepted && call.from === data.from) {
        console.log('⚠️ [IncomingCall] Call already accepted - ignoring duplicate event');
        return;
      }
      
      // CRITICAL: Security/Isolation check - only process calls intended for this user
      // Use normalized string comparison (avoids ObjectId vs string mismatch)
      const currentUserId = userIdRef.current || user?._id;
      const userToCall = data.userToCall != null ? String(data.userToCall).trim() : '';
      const currentId = currentUserId != null ? String(currentUserId).trim() : '';
      if (userToCall && currentId && userToCall !== currentId) {
        console.log('⚠️ [IncomingCall] Ignoring call - not intended for this user', {
          userToCall,
          currentId,
        });
        return;
      }
      
      // Set flag to prevent concurrent processing
      processingCallUserRef.current = true;
      
      console.log('⚡⚡⚡ [WebRTC] callUser EVENT RECEIVED! This should appear on receiver! ⚡⚡⚡');
      console.log('═══════════════════════════════════════════════════════');
      console.log('📞 [IncomingCall] ========== INCOMING CALL RECEIVED ==========');
      console.log('📞 [IncomingCall] ⚡ EVENT TRIGGERED - callUser handler is running!');
      console.log('📞 [IncomingCall] Data:', JSON.stringify(data, null, 2));
      console.log('📞 [IncomingCall] Current user ID:', user?._id);
      console.log('📞 [IncomingCall] User ID from ref:', userIdRef.current);
      console.log('📞 [IncomingCall] Caller ID:', data.from);
      console.log('📞 [IncomingCall] Is currently calling:', isCalling);
      console.log('📞 [IncomingCall] Remote user ID from ref:', remoteUserIdRef.current);
      console.log('📞 [IncomingCall] Call intended for:', data.userToCall);
      
      console.log('📞 [IncomingCall] Valid incoming call from:', data.name, `(${data.from})`);
      pendingIceCandidates.current = [];
      
      // CRITICAL: Reset cancel flag for NEW incoming calls
      // This prevents stale pending cancels from interfering with new calls
      callWasCanceledRef.current = false;
      console.log('✅ [IncomingCall] Reset callWasCanceledRef for new incoming call');
      
      const shouldAutoAnswerFromRef = shouldAutoAnswerRef.current === data.from;
      // FIRM: Don't auto-answer if we just cleared stale state (React state might still show old values)
      // Only auto-answer if explicitly set via shouldAutoAnswerRef OR if we're genuinely already receiving this call
      // CRITICAL: If we just cleared stale state, NEVER auto-answer (even if React state shows old values)
      // CRITICAL: Check flag BEFORE any React state checks to prevent false positives
      const justCleared = justClearedStaleStateRef.current;
      // If we just cleared stale state, React state might still show old values, so don't trust it
      // Only check wasAlreadyReceiving if we DIDN'T just clear stale state
      const wasAlreadyReceiving = !justCleared && call.isReceivingCall && call.from === data.from;
      const shouldAutoAnswer = (shouldAutoAnswerFromRef || wasAlreadyReceiving) && !justCleared;
      
      console.log('📞 [IncomingCall] Auto-answer check:', {
        shouldAutoAnswerFromRef,
        wasAlreadyReceiving,
        shouldAutoAnswer,
        hasSignal: !!data.signal,
        callAccepted,
      });
      
      // CRITICAL: Store caller ID persistently for timeout handling (survives cleanup)
      if (data.from) {
        persistentCallerIdRef.current = data.from;
      }
      if (data.callId) {
        activeCallIdRef.current = data.callId;
      }
      
      // CRITICAL: Clear any stale state from previous calls when receiving a new call
      // This prevents old state from interfering with new calls
      
      // 1. Clear ALL pending cancels when receiving a new call (even if same caller - it's a new call)
      getPendingCallData().then((pendingData) => {
        if (pendingData?.hasPendingCancel && pendingData?.callerIdToCancel) {
          console.log('🧹 [IncomingCall] Clearing pending cancel - new call received:', {
            pendingCancelCaller: pendingData.callerIdToCancel,
            newCaller: data.from,
            isSameCaller: pendingData.callerIdToCancel === data.from,
          });
          // Clear even if same caller - this is a NEW call, not the old one
          clearCallData().catch((error) => {
            console.error('❌ [IncomingCall] Error clearing pending cancel:', error);
          });
        }
      }).catch((error) => {
        // Ignore errors - not critical
        console.log('ℹ️ [IncomingCall] Could not check pending cancel (non-critical):', error);
      });
      
      // 2. Clear stale shouldAutoAnswerRef if it's for a different caller
      if (shouldAutoAnswerRef.current && shouldAutoAnswerRef.current !== data.from) {
        console.log('🧹 [IncomingCall] Clearing stale shouldAutoAnswerRef for different caller:', {
          staleCaller: shouldAutoAnswerRef.current,
          newCaller: data.from,
        });
        shouldAutoAnswerRef.current = null;
      }
      
      // 3. Clear stale pending signal request if it's for a different caller
      if (pendingSignalRequestRef.current && pendingSignalRequestRef.current.callerId !== data.from) {
        console.log('🧹 [IncomingCall] Clearing stale pending signal request for different caller:', {
          staleCaller: pendingSignalRequestRef.current.callerId,
          newCaller: data.from,
        });
        pendingSignalRequestRef.current = null;
        hasRequestedSignalRef.current = null;
        hasReceivedSignalForCallerRef.current = null; // P0
        // Clear the timeout
        if (requestSignalTimeoutRef.current) {
          clearTimeout(requestSignalTimeoutRef.current);
          requestSignalTimeoutRef.current = null;
        }
      }
      
      // 4. Clear receiver timeout if it exists (even if same caller - this is a new call)
      if (receiverTimeoutRef.current) {
        console.log('🧹 [IncomingCall] Clearing receiver timeout - new call received:', {
          previousCaller: call.from,
          newCaller: data.from,
        });
        clearTimeout(receiverTimeoutRef.current);
        receiverTimeoutRef.current = null;
      }
      
      const incomingCallState = {
        isReceivingCall: true,
        from: data.from,
        userToCall: data.userToCall,
        name: data.name,
        signal: data.signal,
        callType: data.callType || 'video',
      };
      setCall(incomingCallState);
      setCallType(data.callType || 'video');
      
      // Track processed signal SDP to prevent duplicates; mark signal received for any signal (so signal-wait timeout never fires)
      if (data.signal) {
        if (data.signal.sdp) lastProcessedSignalSdpRef.current = data.signal.sdp;
        hasReceivedSignalForCallerRef.current = data.from; // P0: Ref for signal-wait timeout (avoids stale closure)
      }
      
      // Cancel requestSignal retry and signal-wait timeout since signal is received
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      if (signalWaitTimeoutRef.current) {
        clearTimeout(signalWaitTimeoutRef.current);
        signalWaitTimeoutRef.current = null;
      }
      pendingSignalRequestRef.current = null;
      // Clear hasRequestedSignalRef so we can request again if needed for a new call
      if (hasRequestedSignalRef.current?.callerId === data.from) {
        hasRequestedSignalRef.current = null;
      }
      
      console.log('✅ [IncomingCall] Call state set:', incomingCallState);
      
      // CRITICAL: Track when call signal was received to prevent clearing new calls
      // This prevents AppState handler from clearing calls that just arrived
      if (data.signal) {
        lastCallSignalReceivedRef.current = Date.now();
        console.log('✅ [IncomingCall] Call signal received timestamp recorded:', lastCallSignalReceivedRef.current);
      }
      
      // CRITICAL: Reset the flag AFTER we've set the call state but BEFORE auto-answer check
      // This ensures the flag prevents auto-answer if stale state was just cleared
      const wasJustCleared = justClearedStaleStateRef.current;
      if (wasJustCleared) {
        justClearedStaleStateRef.current = false;
        console.log('✅ [IncomingCall] Reset justClearedStaleStateRef flag - stale state was cleared');
      }
      
      // Auto-answer if Answer button was pressed (native UI → CallScreen)
      // FIRM: Don't auto-answer if we just cleared stale state (prevents accidental auto-answer after reconnect)
      if (shouldAutoAnswer && data.signal && !callAccepted && !wasJustCleared) {
        console.log('📞 [IncomingCall] Auto-answering call (handler)...');
        shouldAutoAnswerRef.current = null;
        const sig = data.signal;
        const from = data.from;
        // Use minimal delay (next tick) so React can process setCall – 0ms for faster connection
        setTimeout(async () => {
          try {
            await answerCall(sig, from);
            console.log('✅ [IncomingCall] Auto-answer completed');
          } catch (err: any) {
            const canceled = err?.message && String(err?.message).includes('Call was canceled');
            if (!canceled) console.error('❌ [IncomingCall] Error auto-answering call:', err);
            shouldAutoAnswerRef.current = from;
          }
        }, 0);
      } else if (shouldAutoAnswer && !data.signal && !wasJustCleared) {
        console.log('📞 [IncomingCall] Requesting call signal (no signal in data)');
        const connected = socket?.getSocket?.()?.connected === true || socket?.isSocketConnected?.();
        if (connected && !pendingSignalRequestRef.current) {
          pendingSignalRequestRef.current = { callerId: data.from, receiverId: user?._id || '' };
          socket.emit('requestCallSignal', {
            callerId: data.from,
            receiverId: user?._id,
          });
        }
      } else {
        console.log('📞 [IncomingCall] Waiting for user to answer...');
        
        // SAFETY GUARD: Set receiver timeout to clear "Incoming call..." if no connection is established
        // This prevents the UI from being stuck if the caller times out or disconnects
        if (receiverTimeoutRef.current) {
          clearTimeout(receiverTimeoutRef.current);
        }
        receiverTimeoutRef.current = setTimeout(() => {
          // Check if we're still receiving this call and no connection was established
          if (call.isReceivingCall && call.from === data.from && !callAccepted && !peerConnection.current) {
            console.warn('⚠️ [IncomingCall] Receiver timeout - no connection established, resetting so user can call again');
            if (socket?.isSocketConnected?.() && data.from && userIdRef.current) {
              socket.emit('cancelCall', {
                conversationId: data.from,
                sender: userIdRef.current,
              });
            }
            try {
              const { NativeModules } = require('react-native');
              const { CallDataModule } = NativeModules;
              if (CallDataModule && CallDataModule.dismissCallNotification) {
                CallDataModule.dismissCallNotification().catch(() => {});
              }
            } catch (_) {}
            resetAllCallState();
          }
          receiverTimeoutRef.current = null;
        }, WEBRTC_CONFIG.CONNECTION_TIMEOUT + 5000); // Give extra 5 seconds beyond caller timeout
      }
      
      // CRITICAL: Reset processing flag after handler completes
      // This prevents the flag from blocking future calls if the current call fails or times out
      // The flag only prevents concurrent processing of the SAME event (handled by the early returns above)
      // Use a timeout to allow state updates to complete before resetting
      setTimeout(() => {
        processingCallUserRef.current = false;
        console.log('✅ [IncomingCall] Processing flag reset - ready for new calls');
      }, 1000);
      
      console.log('═══════════════════════════════════════════════════════');
    });

    // Call answered. Backend may send { signal, callId } or raw signal.
    socket.on('callAccepted', async (signalOrPayload: any) => {
      const payload = signalOrPayload && typeof signalOrPayload === 'object' && 'signal' in signalOrPayload ? signalOrPayload : { signal: signalOrPayload };
      const callId = payload.callId;
      const signal = payload.signal ?? signalOrPayload;
      if (callId != null && activeCallIdRef.current != null && activeCallIdRef.current !== callId) {
        console.log('⚠️ [CallAccepted] callId mismatch – ignoring');
        return;
      }
      console.log('═══════════════════════════════════════════════════════');
      console.log('📞 [CallAccepted] ========== CALL ACCEPTED BY RECEIVER ==========');
      console.log('📞 [CallAccepted] Signal received:', {
        hasSignal: !!signal,
        signalType: signal?.type,
        sdpLength: signal?.sdp?.length || 0,
      });
      console.log('📞 [CallAccepted] Peer connection state:', {
        hasPeer: !!peerConnection.current,
        connectionState: peerConnection.current?.connectionState,
        signalingState: peerConnection.current?.signalingState,
      });
      console.log('📞 [CallAccepted] Call state:', {
        isCalling,
        callAccepted,
        callEnded,
        hasRemoteUserId: !!remoteUserIdRef.current,
      });
      
      // CRITICAL: Ignore stale answers that arrive after call was canceled/ended
      // This can happen if receiver pressed answer before cancel arrived, and answer arrives after cancel
      // BUT: Always process answers if we're actively calling (isCalling=true) - it's a new call
      // Also process if we have a peer connection that's not closed/disconnected/failed
      const hasActivePeerConnection = peerConnection.current && 
                                     peerConnection.current.connectionState !== 'closed' && 
                                     peerConnection.current.connectionState !== 'disconnected' &&
                                     peerConnection.current.connectionState !== 'failed';
      
      // CRITICAL: If we're actively calling, always process the answer (it's for the current call)
      if (isCalling) {
        console.log('✅ [CallAccepted] Processing answer - actively calling (new call)');
      } else if (hasActivePeerConnection) {
        // If we have an active peer connection, it's likely a new call - process the answer
        console.log('✅ [CallAccepted] Processing answer - active peer connection indicates new call');
      } else if (callWasCanceledRef.current || callEnded) {
        // Only ignore if call was canceled/ended AND we're not calling AND no active peer connection
        console.warn('⚠️ [CallAccepted] Ignoring stale answer - call was already canceled/ended');
        console.warn('⚠️ [CallAccepted] This is a delayed answer from a canceled call');
        console.warn('⚠️ [CallAccepted] Call state:', {
          callWasCanceled: callWasCanceledRef.current,
          callEnded,
          isCalling,
          hasRemoteUserId: !!remoteUserIdRef.current,
          hasPersistentCallerId: !!persistentCallerIdRef.current,
          hasActivePeerConnection,
          connectionState: peerConnection.current?.connectionState,
        });
        // Clear any queued answer to prevent it from being processed later
        pendingAnswerRef.current = null;
        return; // Exit early, don't process this stale answer
      } else if (!isCalling && !remoteUserIdRef.current && !persistentCallerIdRef.current) {
        // Also ignore if we're not calling and have no way to identify the caller
        console.warn('⚠️ [CallAccepted] Ignoring answer - no active call state');
        console.warn('⚠️ [CallAccepted] Call state:', {
          isCalling,
          hasRemoteUserId: !!remoteUserIdRef.current,
          hasPersistentCallerId: !!persistentCallerIdRef.current,
          hasActivePeerConnection,
        });
        pendingAnswerRef.current = null;
        return;
      }
      
      setCallAccepted(true);
      setIsCalling(false);
      
      // If peer connection is not ready yet, queue the answer
      // This can happen if answer arrives before peer connection is created (race condition)
      if (!peerConnection.current) {
        console.warn('⚠️ [CallAccepted] Peer connection not ready yet - queuing answer');
        console.warn('⚠️ [CallAccepted] This can happen if answer arrives before peer connection is created');
        if (signal) {
          pendingAnswerRef.current = new RTCSessionDescription(signal);
          console.log('✅ [CallAccepted] Answer queued - will be processed when peer connection is ready');
        }
        return; // Exit early, answer will be processed when peer connection is created
      }
      
      if (peerConnection.current && signal) {
        try {
          // CRITICAL: Check signaling state before setting remote description
          // An answer can only be set in "have-local-offer" state (we sent offer, waiting for answer)
          // If state is "stable", "have-remote-offer", or "closed", it's a stale answer - ignore it
          const currentState = peerConnection.current.signalingState;
          console.log('📞 [CallAccepted] Current signaling state:', currentState);
          
          if (currentState !== 'have-local-offer') {
            console.warn('⚠️ [CallAccepted] Cannot set remote answer - wrong signaling state:', currentState);
            console.warn('⚠️ [CallAccepted] Expected "have-local-offer" but got:', currentState);
            console.warn('⚠️ [CallAccepted] This is likely a stale answer from a previous call - ignoring');
            pendingAnswerRef.current = null; // Clear any pending answer
            return; // Don't try to set the remote description
          }
          
          // Double-check state right before setting (race condition protection)
          const stateBeforeSet = peerConnection.current.signalingState;
          if (stateBeforeSet !== 'have-local-offer') {
            console.log('ℹ️ [CallAccepted] State changed between check and set - ignoring answer:', {
              previousState: currentState,
              currentState: stateBeforeSet,
            });
            pendingAnswerRef.current = null;
            return; // State changed, don't set
          }
          
          console.log('📞 [CallAccepted] Setting remote description (answer)...');
          await peerConnection.current.setRemoteDescription(
            new RTCSessionDescription(signal)
          );
          console.log('✅ [CallAccepted] Remote description set successfully:', {
            signalingState: peerConnection.current.signalingState,
          });
          
          // Process any queued ICE candidates that arrived before remote description was set
          if (pendingIceCandidates.current.length > 0) {
            console.log(`📦 [CallAccepted] Processing ${pendingIceCandidates.current.length} queued ICE candidates...`);
            for (const candidate of pendingIceCandidates.current) {
              try {
                await peerConnection.current.addIceCandidate(candidate);
                console.log('✅ [CallAccepted] Queued ICE candidate added');
              } catch (error: any) {
                // Some errors are non-fatal (e.g., duplicate candidates)
                if (error.message && !error.message.includes('already have')) {
                  console.error('❌ [CallAccepted] Error adding queued ICE candidate:', error);
                } else {
                  console.log('⚠️ [CallAccepted] Candidate already added (ignoring)');
                }
              }
            }
            pendingIceCandidates.current = [];
            console.log('✅ [CallAccepted] All queued ICE candidates processed');
          }
        } catch (error: any) {
          // CRITICAL: Handle "wrong state" errors gracefully - they're non-fatal
          // This can happen if the answer arrives after the connection is already established
          // or if there's a race condition where the state changes between check and execution
          const errorMessage = error?.message || '';
          const isWrongStateError = errorMessage.includes('wrong state') || 
                                   errorMessage.includes('Called in wrong state') ||
                                   errorMessage.includes('stable');
          
          if (isWrongStateError) {
            // This is a harmless error - the call is already working, just log as info
            console.log('ℹ️ [CallAccepted] Answer arrived in wrong state (call already established) - ignoring:', {
              state: peerConnection.current?.signalingState,
              connectionState: peerConnection.current?.connectionState,
            });
            // Clear any pending answer to prevent retries
            pendingAnswerRef.current = null;
          } else {
            // For other errors, log as warning (not error) since call might still work
            console.warn('⚠️ [CallAccepted] Error setting remote description (non-fatal):', errorMessage);
          }
        }
      } else {
        console.error('❌ [CallAccepted] Missing peer connection or signal:', {
          hasPeer: !!peerConnection.current,
          hasSignal: !!signal,
        });
      }
      console.log('═══════════════════════════════════════════════════════');
    });

    // ICE candidate received (Trickle ICE - process immediately). FIRM: ignore only when BOTH callIds set and different.
    socket.on('iceCandidate', async (data: any) => {
      if (data.callId != null && activeCallIdRef.current != null && activeCallIdRef.current !== data.callId) {
        console.log('⚠️ [ICE] callId mismatch – ignoring candidate');
        return;
      }
      console.log('🧊 [ICE] ========== ICE CANDIDATE RECEIVED ==========');
      console.log('🧊 [ICE] Data:', {
        from: data.from,
        hasCandidate: !!data.candidate,
        candidateType: data.candidate?.type,
      });
      
      if (data.candidate) {
        try {
          const candidate = new RTCIceCandidate(data.candidate);
          console.log('🧊 [ICE] Candidate created:', {
            type: candidate.type,
            candidate: candidate.candidate?.substring(0, 50) + '...',
          });
          
          if (peerConnection.current) {
            // Check if remote description is set (required before adding candidates)
            if (peerConnection.current.remoteDescription) {
              try {
                console.log('🧊 [ICE] Adding ICE candidate to peer connection...');
                await peerConnection.current.addIceCandidate(candidate);
                console.log('✅ [ICE] ICE candidate added successfully');
              } catch (error: any) {
                // Some errors are non-fatal (e.g., duplicate candidates)
                if (error.message && !error.message.includes('already have')) {
                  console.error('❌ [ICE] Error adding ICE candidate:', error);
                  console.error('❌ [ICE] Error message:', error?.message);
                } else {
                  console.log('⚠️ [ICE] Candidate already added (ignoring)');
                }
              }
            } else {
              // Remote description not set yet, queue candidate
              console.log('⏳ [ICE] Remote description not set, queuing candidate');
              pendingIceCandidates.current.push(candidate);
              console.log('📦 [ICE] Queued candidates count:', pendingIceCandidates.current.length);
            }
          } else {
            // Peer connection not created yet, queue candidate
            console.log('⏳ [ICE] Peer connection not ready, queuing candidate');
            pendingIceCandidates.current.push(candidate);
            console.log('📦 [ICE] Queued candidates count:', pendingIceCandidates.current.length);
          }
        } catch (error: any) {
          console.error('❌ [ICE] Error creating ICE candidate:', error);
          console.error('❌ [ICE] Error message:', error?.message);
        }
      } else {
        console.log('⚠️ [ICE] No candidate in data');
      }
    });

    // Call canceled. FIRM: ignore only when BOTH sides have callId and they don't match.
    // If receiver has no callId (e.g. got call via notification/requestCallSignal which doesn't send callId), still process.
    socket.on('CallCanceled', (payload?: { callId?: string }) => {
      if (
        payload?.callId != null &&
        activeCallIdRef.current != null &&
        activeCallIdRef.current !== payload.callId
      ) {
        console.log('⚠️ [WebRTC] CallCanceled for different call – ignoring');
        return;
      }
      if (processingCallCanceledRef.current) {
        console.log('⚠️ [WebRTC] Already processing CallCanceled - ignoring duplicate');
        return;
      }
      if (callEnded && !isCalling && !callAccepted) {
        console.log('✅ [WebRTC] Call already ended - skipping CallCanceled processing (optimization)');
        return;
      }
      
      // Dedupe: backend may emit CallCanceled multiple times – ignore if we just processed one
      const now = Date.now();
      if (now - lastCallCanceledProcessedAtRef.current < 2000) {
        console.log('⚠️ [WebRTC] CallCanceled duplicate – ignoring (processed recently)');
        return;
      }
      lastCallCanceledProcessedAtRef.current = now;
      
      // CRITICAL: Set flag IMMEDIATELY to prevent duplicate processing
      processingCallCanceledRef.current = true;
      callWasCanceledRef.current = true; // Mark that call was canceled to ignore stale answers
      
      // Store canceled call info – only use callId for matching (from/userToCall can be wrong if state cleared)
      const storedCallId = activeCallIdRef.current || undefined;
      if (storedCallId) {
        lastCanceledCallRef.current = {
          from: call.from || '',
          userToCall: call.userToCall || '',
          callId: storedCallId,
          at: Date.now(),
        };
        console.log('📴 [WebRTC] Stored lastCanceledCall (2s window):', lastCanceledCallRef.current);
      }
      
      console.log('📴 [WebRTC] ========== CALL CANCELED RECEIVED ==========');
      console.log('📴 [WebRTC] Other user canceled the call');
      
      // CRITICAL: Dismiss native notification/IncomingCallActivity to close the UI
      try {
        const { NativeModules } = require('react-native');
        const { CallDataModule } = NativeModules;
        if (CallDataModule && CallDataModule.dismissCallNotification) {
          CallDataModule.dismissCallNotification().then(() => {
            console.log('✅ [WebRTC] Native notification/UI dismissed due to cancel');
          }).catch((error: any) => {
            console.warn('⚠️ [WebRTC] Could not dismiss notification:', error);
          });
        }
      } catch (error) {
        console.warn('⚠️ [WebRTC] Could not dismiss notification:', error);
      }
      
      setPendingCancel(false);
      // FIRM: Same full reset so user can call again (both users end call → same clean state)
      resetAllCallState();
    });

    // User busy / offline error – full reset so user can call again. FIRM: ignore if callId mismatch.
    // FIRM (Mu side): show message ~2.5s then full reset so user can call again.
    socket.on('callBusyError', (data: any) => {
      if (data.callId != null && activeCallIdRef.current != null && activeCallIdRef.current !== data.callId) {
        console.log('⚠️ [WebRTC] callBusyError for different call – ignoring');
        return;
      }
      const reason = data.reason || 'busy';
      console.log('❌ [WebRTC] CALLBACK_BLOCKED: callBusyError received – backend rejected the call!', {
        reason,
        busyUserId: data.busyUserId,
        message: data.message,
        scenario: 'B_calls_A_after_cancel - A or B still marked busy in Redis',
      });
      console.log('📴 [WebRTC] callBusyError –', reason, ', will full reset after message shown');
      setCallBusyReason(reason);
      setCallEnded(true);
      const showMessageMs = reason === 'offline' || reason === 'busy' ? 2500 : 0;
      setTimeout(() => {
        resetAllCallState();
        setCallBusyReason(null);
      }, showMessageMs + 100);
    });

    // Handle resendCallSignal request from backend (when signal request fails)
    socket.on('resendCallSignal', async ({ receiverId }: { receiverId: string }) => {
      console.log('📞 [ResendCallSignal] Backend requested to re-send call signal');
      console.log('📞 [ResendCallSignal] Receiver ID:', receiverId);
      
      // Only re-send if we're currently calling this user
      if (isCalling && remoteUserIdRef.current === receiverId && call.signal) {
        console.log('✅ [ResendCallSignal] Re-sending call signal to:', receiverId);
        const resendPayload: any = {
          userToCall: receiverId,
          from: user?._id || userIdRef.current,
          name: user?.name || 'Unknown',
          signal: call.signal,
          callType: call.callType || 'video',
        };
        if (activeCallIdRef.current) resendPayload.callId = activeCallIdRef.current;
        socket.emit('callUser', resendPayload);
        console.log('✅ [ResendCallSignal] Call signal re-sent');
      } else {
        console.warn('⚠️ [ResendCallSignal] Cannot re-send - not calling this user or no signal available', {
          isCalling,
          remoteUserIdRef: remoteUserIdRef.current,
          receiverId,
          hasSignal: !!call.signal,
        });
      }
    });

    // Sync "Connected" + timer from other peer. FIRM: ignore if callId mismatch.
    socket.on('callConnected', (data: { startTime?: number; callId?: string }) => {
      const startTime = data?.startTime;
      if (typeof startTime !== 'number') return;
      if (data.callId != null && activeCallIdRef.current != null && activeCallIdRef.current !== data.callId) {
        console.log('⚠️ [WebRTC] callConnected callId mismatch – ignoring');
        return;
      }
      setDisplayConnectedFromPeer(true);
      if (!callDurationIntervalRef.current) {
        setCallDuration(0);
        callStartTimeRef.current = startTime;
        callDurationIntervalRef.current = true as any;
      } else if (callStartTimeRef.current != null) {
        const use = Math.min(callStartTimeRef.current, startTime);
        callStartTimeRef.current = use;
      }
    });

    // CRITICAL: Emit pending signal request only AFTER all listeners are attached, so we don't miss callUser.
    // (Connect handler only bumps socketConnectKey; this effect runs, re-attaches listeners, then we emit.)
    // When user answered from notification (cold start), socket may connect after we set pendingSignalRequestRef – always send so call connects.
    const sock = socket.getSocket?.();
    if (sock?.connected && pendingSignalRequestRef.current) {
      const payload = pendingSignalRequestRef.current;
      const uid = userIdRef.current || user?._id;
      if (payload && uid && payload.receiverId === uid) {
        const { callerId } = payload;
        const alreadyReceivedSignal = hasReceivedSignalForCallerRef.current === callerId;
        const requestedRecently = hasRequestedSignalRef.current?.callerId === callerId &&
          (Date.now() - (hasRequestedSignalRef.current?.timestamp ?? 0)) < 5000;
        if (!alreadyReceivedSignal && !requestedRecently) {
          setTimeout(() => {
            if (!pendingSignalRequestRef.current) return;
            const p = pendingSignalRequestRef.current;
            if (userIdRef.current && p.receiverId === userIdRef.current) {
              console.log('📡 [WebRTC] Sending pending signal request (after listeners attached)');
              socket.emit('requestCallSignal', p);
              hasRequestedSignalRef.current = { callerId: p.callerId, timestamp: Date.now() };
            }
          }, 0);
        }
      }
    }

    return () => {
      console.log('🧹 [WebRTC] Cleaning up socket listeners...');
      socket.off('callUser');
      socket.off('callAccepted');
      socket.off('iceCandidate');
      socket.off('CallCanceled');
      socket.off('callBusyError');
      socket.off('callConnected');
      socket.off('resendCallSignal');
    };
  }, [socket, user, socketConnectKey]); // socketConnectKey bumps on connect/reconnect so we re-attach listeners

  // Listen for CheckPendingCancel event from MainActivity (triggered when IncomingCallActivity closes)
  // This provides immediate trigger when Decline is pressed, instead of waiting for polling
  useEffect(() => {
    console.log('📴 [WebRTC] Setting up CheckPendingCancel listener...');
    
    const checkPendingCancelListener = DeviceEventEmitter.addListener('CheckPendingCancel', async () => {
      console.log('📴 [WebRTC] ========== CheckPendingCancel EVENT RECEIVED ==========');
      console.log('📴 [WebRTC] Triggering immediate check of SharedPreferences for pending cancel...');
      
      // Trigger immediate check of SharedPreferences and handle cancel if found
      if (!socket || !user?._id) {
        console.log('⏳ [WebRTC] Socket or user not ready yet, will check when ready');
        return;
      }
      
      try {
        const pendingData = await getPendingCallData();
        const hasCancel = !!(pendingData?.hasPendingCancel || pendingData?.shouldCancelCall);
        const callerIdToCancel = pendingData?.callerIdToCancel;
        
        if (!hasCancel || !callerIdToCancel) {
          console.log('📴 [WebRTC] No pending cancel found in SharedPreferences');
          return;
        }

        // CRITICAL: Same caller has a new pending call (user declined first time, then answered second call)
        // Don't run cancel flow - clear cancel and allow the new call
        if (pendingData?.hasPendingCall && pendingData?.callerId === callerIdToCancel) {
          console.log('⚠️ [WebRTC] New call from same caller (pending call + pending cancel) - ignoring cancel, allowing new call', {
            callerId: pendingData.callerId,
            callerIdToCancel,
          });
          setPendingCancel(false);
          setCallEnded(false);
          clearCallData().then(() => {
            console.log('✅ [WebRTC] Stale pending cancel cleared - new call can proceed');
          }).catch((err) => console.error('❌ [WebRTC] Error clearing:', err));
          return;
        }
        
        console.log('📴 [WebRTC] ========== PENDING CANCEL DETECTED VIA CheckPendingCancel EVENT ==========');
        console.log('📴 [WebRTC] Caller ID to cancel:', callerIdToCancel);
        
        // Set pendingCancel flag to prevent navigation
        setPendingCancel(true);
        
        // Clear call state
        cleanupPeer();
        setIsCalling(false);
        setCallEnded(true);
        setCallAccepted(false);
        setCall({
          isReceivingCall: false,
          from: undefined,
          userToCall: undefined,
          name: undefined,
          signal: undefined,
          callType: 'audio',
        });
        remoteUserIdRef.current = null;
        pendingSignalRequestRef.current = null;
        hasRequestedSignalRef.current = null;
        hasReceivedSignalForCallerRef.current = null; // P0
        if (requestSignalTimeoutRef.current) {
          clearTimeout(requestSignalTimeoutRef.current);
          requestSignalTimeoutRef.current = null;
        }
        if (signalWaitTimeoutRef.current) {
          clearTimeout(signalWaitTimeoutRef.current);
          signalWaitTimeoutRef.current = null;
        }
        
        // Emit cancelCall socket event
        if (socket.isSocketConnected()) {
          const cancelData = {
            conversationId: callerIdToCancel,
            sender: user._id,
          };
          
          console.log('📴 [WebRTC] Emitting cancelCall event from CheckPendingCancel:', cancelData);
          socket.emit('cancelCall', cancelData);
          console.log('✅ [WebRTC] cancelCall event emitted to backend');
          
          // Clear SharedPreferences
          await clearCallData();
          console.log('✅ [WebRTC] SharedPreferences cleared');
          
          // Reset pendingCancel after a short delay
          setTimeout(() => {
            setPendingCancel(false);
            console.log('✅ [WebRTC] pendingCancel flag reset - navigation allowed again');
          }, 1000);
        } else {
          console.log('⏳ [WebRTC] Socket not connected yet, will retry...');
          // The polling mechanism will retry when socket connects
        }
      } catch (error) {
        console.error('❌ [WebRTC] Error checking SharedPreferences:', error);
      }
    });

    return () => {
      console.log('🧹 [WebRTC] Cleaning up CheckPendingCancel listener...');
      checkPendingCancelListener.remove();
    };
  }, [socket, user?._id]);

  // Listen for CancelCallFromNotification event from native code (Decline button)
  useEffect(() => {
    console.log('📴 [WebRTC] Setting up CancelCallFromNotification listener...');
    
    const cancelCallListener = DeviceEventEmitter.addListener('CancelCallFromNotification', (data: { callerId: string }) => {
      console.log('📴 [WebRTC] ========== CancelCallFromNotification EVENT RECEIVED ==========');
      console.log('📴 [WebRTC] Caller ID to cancel:', data.callerId);
      
      // CRITICAL: Set pendingCancel flag FIRST to prevent any navigation
      setPendingCancel(true);
      console.log('📴 [WebRTC] pendingCancel flag set to true - navigation blocked');
      
      // CRITICAL: Clear call state IMMEDIATELY (before socket emit) to prevent navigation
      // This must happen first to prevent AppNavigator from navigating to CallScreen
      console.log('📴 [WebRTC] Clearing call state immediately...');
      cleanupPeer();
      setIsCalling(false);
      setCallEnded(true);
      setCallAccepted(false);
      setCall({
        isReceivingCall: false,
        from: undefined,
        userToCall: undefined,
        name: undefined,
        signal: undefined,
        callType: 'audio',
      });
      remoteUserIdRef.current = null;
      pendingSignalRequestRef.current = null;
      hasRequestedSignalRef.current = null;
      hasReceivedSignalForCallerRef.current = null; // P0
      shouldAutoAnswerRef.current = null;
      incomingCallFromNotificationCallerIdRef.current = null;
      setIncomingCallFromNotificationCallerId(null);
      persistentCallerIdRef.current = null;
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      if (signalWaitTimeoutRef.current) {
        clearTimeout(signalWaitTimeoutRef.current);
        signalWaitTimeoutRef.current = null;
      }
      console.log('✅ [WebRTC] Call state cleared - navigation prevented');
      
      const callerId = data.callerId;
      const currentUserId = user?._id;
      const cancelPayload = callerId && currentUserId
        ? { conversationId: callerId, sender: currentUserId }
        : null;

      const done = () => {
        clearCallData().catch((e) => console.error('❌ [WebRTC] Error clearing SharedPreferences:', e));
        setTimeout(() => {
          setPendingCancel(false);
          console.log('✅ [WebRTC] pendingCancel flag reset - navigation allowed again');
        }, 1000);
      };

      // Notify backend so caller (A) gets CallCanceled. Prefer socket; fallback to HTTP when socket not ready (e.g. app cold start on Decline).
      if (cancelPayload) {
        if (socket?.isSocketConnected?.()) {
          console.log('📴 [WebRTC] Emitting cancelCall event:', cancelPayload);
          socket.emit('cancelCall', cancelPayload);
          console.log('✅ [WebRTC] cancelCall event emitted to backend');
          done();
        } else {
          console.log('📴 [WebRTC] Socket not connected - using HTTP cancel so caller gets CallCanceled');
          apiService
            .post('/api/call/cancel', cancelPayload)
            .then(() => {
              console.log('✅ [WebRTC] HTTP cancelCall succeeded - caller will get CallCanceled');
              done();
            })
            .catch((err) => {
              console.error('❌ [WebRTC] HTTP cancelCall failed:', err?.response?.data ?? err?.message ?? err);
              done();
            });
        }
      } else {
        console.error('❌ [WebRTC] Cannot cancel - missing callerId or userId');
        done();
      }
    });
    
    return () => {
      console.log('🧹 [WebRTC] Cleaning up CancelCallFromNotification listener...');
      cancelCallListener.remove();
    };
  }, [socket, user?._id]); // Depend on socket and user._id

  // Handle "call ended/canceled" push while app is foreground (FCMService emits this).
  // Without this, receiver can get stuck on "Incoming call..." when caller cancels.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CallEndedFromFCM', async (payload: { callerId?: string }) => {
      const callerId = payload?.callerId != null ? String(payload.callerId).trim() : '';
      if (!callerId) return;

      const pendingIncomingFrom = call?.from != null ? String(call.from).trim() : '';
      const pendingOutgoingTo = call?.userToCall != null ? String(call.userToCall).trim() : '';
      const matches =
        (call?.isReceivingCall && pendingIncomingFrom && pendingIncomingFrom === callerId) ||
        (isCalling && pendingOutgoingTo && pendingOutgoingTo === callerId);
      if (!matches) return;

      console.log('📴 [WebRTC] CallEndedFromFCM matched current call - clearing state', {
        callerId,
        isReceivingCall: call?.isReceivingCall,
        isCalling,
        callAccepted,
      });

      callWasCanceledRef.current = true;
      justClearedStaleStateRef.current = true;
      lastCallSignalReceivedRef.current = null;

      try {
        cleanupPeer();
      } catch {}

      setIsCalling(false);
      setCallAccepted(false);
      setCallEnded(true);
      setCall({
        isReceivingCall: false,
        from: undefined,
        userToCall: undefined,
        name: undefined,
        signal: undefined,
        callType: 'audio',
      });
      setDisplayConnectedFromPeer(false);

      remoteUserIdRef.current = null;
      persistentCallerIdRef.current = null;
      pendingSignalRequestRef.current = null;
      hasRequestedSignalRef.current = null;
      hasReceivedSignalForCallerRef.current = null;
      lastProcessedSignalSdpRef.current = null;
      processingCallUserRef.current = false;
      processingCallCanceledRef.current = false;
      isAnsweringRef.current = false;

      if (receiverTimeoutRef.current) {
        clearTimeout(receiverTimeoutRef.current);
        receiverTimeoutRef.current = null;
      }
      if (signalWaitTimeoutRef.current) {
        clearTimeout(signalWaitTimeoutRef.current);
        signalWaitTimeoutRef.current = null;
      }
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }

      try {
        await clearCallData();
      } catch {}

      setTimeout(() => {
        setCallEnded(false);
        justClearedStaleStateRef.current = false;
        console.log('✅ [WebRTC] CallEndedFromFCM cleanup complete - ready for new calls');
      }, 300);
    });

    return () => sub.remove();
  }, [call, callAccepted, isCalling]);

  // Check SharedPreferences for pending cancel on mount (when app starts or becomes active)
  // This handles the case where Decline was pressed but MainActivity wasn't launched
  useEffect(() => {
    const checkAndHandlePendingCancel = async () => {
      // CRITICAL: Check if socket and user are ready
      if (!socket || !user?._id) {
        console.log('⏳ [WebRTC] Socket or user not ready yet, cannot check pending cancel', {
          hasSocket: !!socket,
          hasUser: !!user?._id
        });
        return; // Wait for socket and user to be ready
      }
      
      // Prevent duplicate processing
      if (processingPendingCancelRef.current) {
        console.log('⏸️ [WebRTC] Already processing pending cancel - skipping duplicate check');
        return;
      }
      
      try {
        const pendingData = await getPendingCallData();
        const hasCancel = !!(pendingData?.hasPendingCancel || pendingData?.shouldCancelCall);
        const callerIdToCancel = pendingData?.callerIdToCancel;
        
        // Only log if there's actually a pending cancel (reduce log spam)
        if (hasCancel && callerIdToCancel) {
          console.log('🔍 [WebRTC] Checking SharedPreferences for pending cancel:', {
            hasPendingCancel: pendingData?.hasPendingCancel,
            shouldCancelCall: pendingData?.shouldCancelCall,
            callerIdToCancel,
            hasCancel
          });
        }
        
        if (!hasCancel || !callerIdToCancel) {
          return; // No pending cancel - exit early to prevent unnecessary processing
        }

        // CRITICAL: Same caller has a new pending call (user declined first time, then answered second call)
        if (pendingData?.hasPendingCall && pendingData?.callerId === callerIdToCancel) {
          console.log('⚠️ [WebRTC] New call from same caller (pending call + pending cancel) - ignoring cancel, allowing new call', {
            callerId: pendingData.callerId,
            callerIdToCancel,
          });
          setPendingCancel(false);
          setCallEnded(false);
          clearCallData().then(() => {
            console.log('✅ [WebRTC] Stale pending cancel cleared - new call can proceed');
          }).catch((err) => console.error('❌ [WebRTC] Error clearing:', err));
          return;
        }

        // CRITICAL: Check if callWasCanceledRef was reset (new call arrived)
        // If it was reset to false, a new call from this caller arrived, so ignore this stale cancel
        if (!callWasCanceledRef.current) {
          console.log('⚠️ [WebRTC] Stale pending cancel detected - new call arrived, ignoring cancel', {
            pendingCancelCaller: callerIdToCancel,
            callWasCanceledRef: callWasCanceledRef.current,
          });
          setPendingCancel(false);
          setCallEnded(false);
          clearCallData().then(() => {
            console.log('✅ [WebRTC] Stale pending cancel cleared from SharedPreferences');
          }).catch((error) => {
            console.error('❌ [WebRTC] Error clearing stale pending cancel:', error);
          });
          return; // Don't process stale cancel - new call is in progress
        }

        // CRITICAL: Check if there's an active incoming call
        // If there is, only process cancel if it matches the current caller
        // Otherwise, it's a stale cancel from a previous call - ignore it
        const currentIncomingCaller = call.from || persistentCallerIdRef.current;
        if (currentIncomingCaller && currentIncomingCaller !== callerIdToCancel) {
          // There's an active incoming call from a different caller
          // This pending cancel is stale - clear it and ignore
          console.log('⚠️ [WebRTC] Stale pending cancel detected - ignoring', {
            pendingCancelCaller: callerIdToCancel,
            currentIncomingCaller: currentIncomingCaller,
            isReceivingCall: call.isReceivingCall,
          });
          setPendingCancel(false);
          setCallEnded(false);
          clearCallData().then(() => {
            console.log('✅ [WebRTC] Stale pending cancel cleared from SharedPreferences');
          }).catch((error) => {
            console.error('❌ [WebRTC] Error clearing stale pending cancel:', error);
          });
          return; // Don't process stale cancel
        }

        // If there's an active incoming call and it matches, process the cancel
        // If there's no active call, process the cancel (might be from a previous session)
        console.log('📴 [WebRTC] ========== PENDING CANCEL DETECTED IN SHAREDPREFERENCES ==========');
        console.log('📴 [WebRTC] Caller ID to cancel:', callerIdToCancel);
        console.log('📴 [WebRTC] Current incoming caller:', currentIncomingCaller);
        console.log('📴 [WebRTC] Socket connected:', socket.isSocketConnected());
        console.log('📴 [WebRTC] User ID:', user._id);
        
        // Mark as processing to prevent duplicates
        processingPendingCancelRef.current = true;
        
        // Set pendingCancel flag to prevent navigation
        setPendingCancel(true);
        
        // Clear call state
        cleanupPeer();
        setIsCalling(false);
        setCallEnded(true);
        setCallAccepted(false);
        setCall({
          isReceivingCall: false,
          from: undefined,
          userToCall: undefined,
          name: undefined,
          signal: undefined,
          callType: 'audio',
        });
        remoteUserIdRef.current = null;
        
        // Wait for socket to connect if not connected yet, then emit cancel
        const emitCancel = () => {
          if (!socket.isSocketConnected()) {
            console.log('⏳ [WebRTC] Socket not connected yet, waiting...');
            return false;
          }

          if (!callerIdToCancel || !user._id) {
            console.error('❌ [WebRTC] Missing callerIdToCancel or user._id');
            return false;
          }

          // Emit cancelCall socket event to notify the caller
          const cancelData = {
            conversationId: callerIdToCancel,
            sender: user._id,
          };
          
          console.log('📴 [WebRTC] Emitting cancelCall event from SharedPreferences:', cancelData);
          socket.emit('cancelCall', cancelData);
          console.log('✅ [WebRTC] cancelCall event emitted to backend');
          
          // Clear SharedPreferences IMMEDIATELY to prevent duplicate processing
          clearCallData().then(() => {
            console.log('✅ [WebRTC] SharedPreferences cleared');
            // Reset processing flag after clearing
            processingPendingCancelRef.current = false;
          }).catch((error) => {
            console.error('❌ [WebRTC] Error clearing SharedPreferences:', error);
            // Reset processing flag even on error
            processingPendingCancelRef.current = false;
          });
          
          // Reset pendingCancel after a short delay
          setTimeout(() => {
            setPendingCancel(false);
            console.log('✅ [WebRTC] pendingCancel flag reset - navigation allowed again');
          }, 1000);
          
          return true; // Successfully emitted
        };

        // Try to emit immediately if socket is connected
        if (socket.isSocketConnected()) {
          emitCancel();
        } else {
          // Wait for socket to connect
          console.log('⏳ [WebRTC] Waiting for socket to connect before emitting cancel...');
          const socketInstance = socket.getSocket?.();
          
          if (socketInstance) {
            const onConnect = () => {
              console.log('✅ [WebRTC] Socket connected, emitting cancel now...');
              emitCancel();
              socketInstance.off('connect', onConnect);
            };
            
            // Check if already connected
            if (socketInstance.connected) {
              emitCancel();
            } else {
              socketInstance.once('connect', onConnect);
            }
          } else {
            // Fallback: retry periodically
            let attempts = 0;
            const maxAttempts = 20; // 10 seconds total
            
            const retryInterval = setInterval(() => {
              attempts++;
              if (socket.isSocketConnected()) {
                clearInterval(retryInterval);
                emitCancel();
              } else if (attempts >= maxAttempts) {
                clearInterval(retryInterval);
                console.error('❌ [WebRTC] Socket did not connect in time, cancel not sent');
              }
            }, 500);
          }
        }
      } catch (error) {
        console.error('[WebRTC] Error checking pending cancel from SharedPreferences:', error);
      }
    };
    
    // Check immediately (will return early if socket/user not ready)
    console.log('🔍 [WebRTC] ========== INITIAL CHECK FOR PENDING CANCEL ON MOUNT ==========');
    console.log('🔍 [WebRTC] Socket ready:', !!socket, 'User ready:', !!user?._id);
    checkAndHandlePendingCancel();
    
    // Also set up a retry mechanism if socket/user aren't ready yet
    let retryCount = 0;
    const maxRetries = 20; // 10 seconds total
    const retryIntervalRef: { current: NodeJS.Timeout | null } = { current: null };
    retryIntervalRef.current = setInterval(() => {
      if (socket && user?._id) {
        console.log('✅ [WebRTC] Socket and user ready, checking pending cancel (retry attempt)', retryCount);
        checkAndHandlePendingCancel();
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
        }
      } else if (retryCount >= maxRetries) {
        console.warn('⚠️ [WebRTC] Socket/user not ready after max retries, stopping retry');
        if (retryIntervalRef.current) {
          clearInterval(retryIntervalRef.current);
          retryIntervalRef.current = null;
        }
      }
      retryCount++;
    }, 500); // Retry every 500ms

    // Also check when app becomes active (in case socket wasn't ready on mount)
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      console.log('📱 [WebRTC] AppState changed:', nextAppState, 'Socket ready:', !!socket, 'User ready:', !!user?._id);
      if (nextAppState === 'active' && socket && user?._id) {
        console.log('📱 [WebRTC] App became active - checking for pending cancel immediately...');
        // Check immediately when app becomes active
        setTimeout(() => {
          checkAndHandlePendingCancel();
        }, 100); // Small delay to ensure everything is ready
        // DISABLED: Pre-acquire on app active – camera stayed on when entering app (WhatsApp doesn't do this)

        // FIRM: Always try to dismiss any native incoming-call UI when we have no active call state.
        // This handles cases where IncomingCallActivity/notification UI stayed visible after background/foreground.
        setTimeout(() => {
          const noActiveCall = !call.isReceivingCall && !callAccepted && !isCalling;
          if (!noActiveCall) return;
          try {
            const { NativeModules } = require('react-native');
            const { CallDataModule } = NativeModules;
            if (CallDataModule?.dismissCallNotification) {
              CallDataModule.dismissCallNotification().catch(() => {});
            }
          } catch (_) {
            // best-effort
          }
          // Also clear stale timestamps so foreground checks don't keep thinking there's an old call.
          lastCallSignalReceivedRef.current = null;
          callWasCanceledRef.current = false;
        }, 250);
        
        // FIRM: Detect and reset stale call state when app comes back to foreground
        // This handles the case where user backgrounds app during incoming call,
        // call gets canceled while backgrounded, but call state persists
        // CRITICAL: Add delay to allow state to stabilize and new calls to process
        setTimeout(() => {
          console.log('🔍 [WebRTC] AppState handler: Checking for stale calls after foreground...');
          console.log('🔍 [WebRTC] Current call state:', {
            isReceivingCall: call.isReceivingCall,
            callAccepted,
            isCalling,
            hasSignal: !!call.signal,
            hasPeer: !!peerConnection.current,
            peerState: peerConnection.current?.connectionState,
            iceState: peerConnection.current?.iceConnectionState,
            callWasCanceled: callWasCanceledRef.current,
            lastSignalTime: lastCallSignalReceivedRef.current,
            timeSinceSignal: lastCallSignalReceivedRef.current ? Date.now() - lastCallSignalReceivedRef.current : null,
            processingCallUser: processingCallUserRef.current,
          });
          const hasStaleIncomingCall = call.isReceivingCall && !callAccepted && !isCalling;
          const hasNoActivePeer = !peerConnection.current || 
                                  peerConnection.current.connectionState === 'closed' ||
                                  peerConnection.current.connectionState === 'failed' ||
                                  peerConnection.current.connectionState === 'disconnected';
          const socketConnected = socket?.isSocketConnected?.() || socket?.getSocket?.()?.connected === true;
          
          // CRITICAL: Don't reset if processingCallUserRef is true (new call might be arriving)
          // This prevents race condition where new call arrives right as we're resetting stale state
          // FIRM: Also reset if call was canceled (definitely stale) OR if peer connection is dead/missing
          const wasCanceled = callWasCanceledRef.current;
          // If peer connection exists but is closed/failed/disconnected, it's definitely stale (even if signal exists)
          const peerIsDead = peerConnection.current && 
                            (peerConnection.current.connectionState === 'closed' ||
                             peerConnection.current.connectionState === 'failed' ||
                             peerConnection.current.connectionState === 'disconnected');
          // FIRM: If no peer connection exists at all AND we have incoming call state, it's stale
          // This handles: User B receives call → backgrounds → returns → no peer connection created yet
          // CRITICAL: Only consider it stale if we're NOT processing a new call (processingCallUserRef check)
          // NOTE: We DON'T check for 'new' state here - legitimate new calls start with 'new' state
          const noPeerConnection = !peerConnection.current;
          
          // CRITICAL: Check if call signal was received recently (within last 5 seconds)
          // If signal was received recently, it's a new call, not stale - don't clear it
          const signalReceivedRecently = lastCallSignalReceivedRef.current && 
                                       (Date.now() - lastCallSignalReceivedRef.current) < 5000; // 5 seconds
          
          // CRITICAL: Also check if we have a signal AND connection is 'new' or 'connecting'
          // This means it's a legitimate new call that just arrived, not stale
          const hasSignal = !!call.signal;
          const isNewCall = peerConnection.current && 
                           (peerConnection.current.connectionState === 'new' || 
                            peerConnection.current.connectionState === 'connecting');
          const isLegitimateNewCall = hasSignal && isNewCall;
          
          // CRITICAL: If we have a signal but no peer connection yet, and signal was received recently,
          // it's a new call that's still being set up, not stale
          const isNewCallBeingSetup = hasSignal && !peerConnection.current && signalReceivedRecently;
          
          // CRITICAL: If call has been in "receiving" state for more than 10 seconds without being accepted,
          // and there's no active peer connection, it's definitely stale (call was likely canceled)
          // Reduced from 30s to 10s to catch calls canceled while backgrounded faster
          const callAge = lastCallSignalReceivedRef.current ? Date.now() - lastCallSignalReceivedRef.current : Infinity;
          const callTooOld = callAge > 10000; // 10 seconds (reduced from 30s)
          const isDefinitelyStale = hasStaleIncomingCall && callTooOld && hasNoActivePeer;
          
          // CRITICAL: Also check if User B returned from background and sees incoming call with no peer
          // This handles: User B receives call → backgrounds → call canceled → User B returns → sees stale UI
          // If socket was disconnected and is now reconnected, and there's no peer connection, it's likely stale
          const returnedFromBackground = hasStaleIncomingCall && hasNoActivePeer && socketConnected;
          const isLikelyStaleAfterBackground = returnedFromBackground && !isLegitimateNewCall && !isNewCallBeingSetup && !signalReceivedRecently;
          
          // CRITICAL: Don't clear if this looks like a legitimate new call
          // (has signal + connection is 'new' or 'connecting' = just arrived, not stale)
          // OR (has signal + no peer yet + signal recent = new call being set up, not stale)
          if (isLegitimateNewCall || isNewCallBeingSetup) {
            console.log('✅ [WebRTC] Detected legitimate new call - not clearing', {
              isLegitimateNewCall,
              isNewCallBeingSetup,
              hasSignal,
              hasPeer: !!peerConnection.current,
              peerState: peerConnection.current?.connectionState,
              signalReceivedRecently,
            });
            return; // Exit early - don't clear legitimate new calls
          }
          
          // CRITICAL: If call is definitely stale (too old + no peer) OR likely stale after background, clear it immediately
          // This handles: User B receives call → backgrounds → call canceled → User B returns → sees stale UI
          if ((isDefinitelyStale || isLikelyStaleAfterBackground) && socketConnected && !processingCallUserRef.current) {
            console.warn('⚠️ [WebRTC] Call is stale (too old OR returned from background with no peer) - clearing immediately', {
              isDefinitelyStale,
              isLikelyStaleAfterBackground,
              callAge,
              hasStaleIncomingCall,
              hasNoActivePeer,
              socketConnected,
              returnedFromBackground,
            });
            justClearedStaleStateRef.current = true;
            setCall({
              isReceivingCall: false,
              from: undefined,
              userToCall: undefined,
              name: undefined,
              signal: undefined,
              callType: 'audio',
            });
            setCallEnded(true);
            setCallAccepted(false);
            setIsCalling(false);
            remoteUserIdRef.current = null;
            persistentCallerIdRef.current = null;
            lastCallSignalReceivedRef.current = null;
            if (receiverTimeoutRef.current) {
              clearTimeout(receiverTimeoutRef.current);
              receiverTimeoutRef.current = null;
            }
            if (signalWaitTimeoutRef.current) {
              clearTimeout(signalWaitTimeoutRef.current);
              signalWaitTimeoutRef.current = null;
            }
            if (requestSignalTimeoutRef.current) {
              clearTimeout(requestSignalTimeoutRef.current);
              requestSignalTimeoutRef.current = null;
            }
            processingCallUserRef.current = false;
            processingCallCanceledRef.current = false;
            callWasCanceledRef.current = false;
            isAnsweringRef.current = false;
            hasReceivedSignalForCallerRef.current = null;
            pendingSignalRequestRef.current = null;
            hasRequestedSignalRef.current = null;
            lastProcessedSignalSdpRef.current = null;
            return; // Exit early after clearing
          }
          
          if ((hasStaleIncomingCall && hasNoActivePeer && socketConnected && !processingCallUserRef.current && !signalReceivedRecently && !isLegitimateNewCall && !isNewCallBeingSetup) || 
              (hasStaleIncomingCall && wasCanceled && !signalReceivedRecently && !isLegitimateNewCall && !isNewCallBeingSetup) ||
              (hasStaleIncomingCall && peerIsDead && socketConnected && !processingCallUserRef.current && !signalReceivedRecently && !isLegitimateNewCall && !isNewCallBeingSetup) ||
              (hasStaleIncomingCall && noPeerConnection && socketConnected && !processingCallUserRef.current && !signalReceivedRecently && !isLegitimateNewCall && !isNewCallBeingSetup)) {
            console.warn('⚠️ [WebRTC] Stale incoming call detected on foreground - resetting call state');
            console.warn('⚠️ [WebRTC] Call state:', {
              isReceivingCall: call.isReceivingCall,
              callAccepted,
              isCalling,
              hasPeer: !!peerConnection.current,
              peerState: peerConnection.current?.connectionState,
              socketConnected,
              signalReceivedRecently,
              isLegitimateNewCall,
              isNewCallBeingSetup,
              hasSignal,
              lastSignalTime: lastCallSignalReceivedRef.current,
              timeSinceSignal: lastCallSignalReceivedRef.current ? Date.now() - lastCallSignalReceivedRef.current : null,
            });
            
            // CRITICAL: Set flag BEFORE clearing state (React state updates are async)
            // This prevents auto-answer if a new call arrives right after clearing stale state
            justClearedStaleStateRef.current = true;
            
            // CRITICAL: Also clear timestamp when clearing stale state
            lastCallSignalReceivedRef.current = null;
            
            // Reset stale call state (call was likely canceled while app was backgrounded)
            setCall({
              isReceivingCall: false,
              from: undefined,
              userToCall: undefined,
              name: undefined,
              signal: undefined,
              callType: 'audio',
            });
            setCallEnded(true);
            setCallAccepted(false);
            setIsCalling(false);
            remoteUserIdRef.current = null;
            persistentCallerIdRef.current = null;
            
            // Clear any pending timeouts
            if (receiverTimeoutRef.current) {
              clearTimeout(receiverTimeoutRef.current);
              receiverTimeoutRef.current = null;
            }
            if (signalWaitTimeoutRef.current) {
              clearTimeout(signalWaitTimeoutRef.current);
              signalWaitTimeoutRef.current = null;
            }
            if (requestSignalTimeoutRef.current) {
              clearTimeout(requestSignalTimeoutRef.current);
              requestSignalTimeoutRef.current = null;
            }
            
            // Reset ALL flags that could block new calls
            processingCallUserRef.current = false;
            processingCallCanceledRef.current = false;
            callWasCanceledRef.current = false;
            isAnsweringRef.current = false; // CRITICAL: Clear answering flag
            hasReceivedSignalForCallerRef.current = null;
            pendingSignalRequestRef.current = null;
            hasRequestedSignalRef.current = null;
            lastProcessedSignalSdpRef.current = null; // CRITICAL: Clear SDP dedupe to allow new call signal
            lastCallSignalReceivedRef.current = null; // CRITICAL: Clear timestamp when clearing stale state
            shouldAutoAnswerRef.current = null;
            pendingAnswerRef.current = null;
            pendingIceCandidates.current = [];
            
            // Clear call data from native storage
            clearCallData().catch(() => {});
            
            // CRITICAL: Also ensure peer connection is fully cleaned up
            if (peerConnection.current) {
              try {
                peerConnection.current.close();
              } catch (e) {
                // Ignore errors - connection might already be closed
              }
              peerConnection.current = null;
            }
            
            // Reset callEnded after a short delay to allow new calls
            setTimeout(() => {
              setCallEnded(false);
              console.log('✅ [WebRTC] callEnded reset - ready for new calls');
            }, 300);
            
            console.log('✅ [WebRTC] Stale call state reset - ALL flags cleared, ready for new calls');
          }
        }, 800); // Check after a delay to ensure state is stable and socket has reconnected
      }

      // If receiver (User B) backgrounds/goes inactive while an incoming call is ringing,
      // immediately clear local call state so the user won't come back to a stuck CallScreen.
      // Best-effort: also notify the caller to stop ringing (only if socket is still connected).
      if ((nextAppState === 'background' || nextAppState === 'inactive')) {
        const snap = callStateSnapshotRef.current;
        const isRingingIncoming = !!(snap.call?.isReceivingCall && !snap.callAccepted && !snap.isCalling);
        if (isRingingIncoming) {
          const callerId = (snap.call?.from != null ? String(snap.call.from).trim() : '') || persistentCallerIdRef.current || '';
          console.log('📴 [WebRTC] Receiver went offline during ringing incoming call - clearing immediately', {
            nextAppState,
            callerId,
          });

          // Dismiss native incoming-call UI/notification (best-effort).
          try {
            const { NativeModules } = require('react-native');
            const { CallDataModule } = NativeModules;
            if (CallDataModule?.dismissCallNotification) {
              CallDataModule.dismissCallNotification().catch(() => {});
            }
          } catch (_) {
            // best-effort
          }

          // Try to notify caller before socket is disconnected (best-effort).
          try {
            const currentUserId = userIdRef.current || user?._id;
            if (callerId && currentUserId && socket?.isSocketConnected?.()) {
              socket.emit('cancelCall', { conversationId: callerId, sender: currentUserId });
            }
          } catch (_) {
            // best-effort
          }

          // Always clear locally (this is the main goal).
          leaveCall();
        }
      }
    });

    // OPTIMIZATION: Removed continuous polling - we rely on:
    // 1. Initial check on mount
    // 2. Retry mechanism if socket/user not ready (stops after maxRetries)
    // 3. AppState change listener (when app becomes active)
    // 4. CheckPendingCancel event from MainActivity (immediate trigger)
    // This prevents infinite polling loops (critical for 1M+ users)

    return () => {
      subscription.remove();
      // Clean up retry interval if it's still running
      if (retryIntervalRef.current) {
        clearInterval(retryIntervalRef.current);
        retryIntervalRef.current = null;
      }
    };
  }, [socket, user?._id]); // Check when socket or user changes

  const contextValue = useMemo(
    () => ({
      localStream,
      remoteStream,
      call,
      callAccepted,
      callEnded,
      isCalling,
      callType,
      callUser,
      answerCall,
      leaveCall,
      toggleMute,
      toggleCamera,
      switchCamera,
      toggleSpeaker,
      isMuted,
      isCameraOff,
      isSpeakerOn,
      connectionState,
      iceConnectionState,
      callDuration,
      callStartTimeRef,
      displayConnectedFromPeer,
      pendingCancel,
      callBusyReason,
      incomingCallFromNotificationCallerId,
      getIncomingCallFromNotificationCallerId: () => incomingCallFromNotificationCallerIdRef.current,
      setIncomingCallFromNotification,
      requestCallSignalForCaller,
    }),
    [
      localStream,
      remoteStream,
      call,
      callAccepted,
      callEnded,
      isCalling,
      callType,
      callUser,
      answerCall,
      leaveCall,
      toggleMute,
      toggleCamera,
      switchCamera,
      toggleSpeaker,
      isMuted,
      isCameraOff,
      isSpeakerOn,
      connectionState,
      iceConnectionState,
      callDuration,
      callStartTimeRef,
      displayConnectedFromPeer,
      pendingCancel,
      callBusyReason,
      incomingCallFromNotificationCallerId,
      setIncomingCallFromNotification,
      requestCallSignalForCaller,
    ]
  );

  return (
    <WebRTCContext.Provider value={contextValue}>
      {children}
    </WebRTCContext.Provider>
  );
};

export const useWebRTC = () => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTC must be used within WebRTCProvider');
  }
  return context;
};
