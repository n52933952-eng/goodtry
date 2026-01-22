import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { Platform, PermissionsAndroid, DeviceEventEmitter, AppState } from 'react-native';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import fcmService from '../services/fcmService';
import { WEBRTC_CONFIG } from '../utils/constants';
import { clearCallData, getPendingCallData } from '../services/callData';

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
  isMuted: boolean;
  isCameraOff: boolean;
  connectionState: string;
  iceConnectionState: string;
  callDuration: number;
  pendingCancel: boolean; // Flag to prevent navigation when cancel is in progress
  setIncomingCallFromNotification: (callerId: string, callerName: string, callType: 'audio' | 'video', shouldAutoAnswer?: boolean) => void;
}

const WebRTCContext = createContext<WebRTCContextType | undefined>(undefined);

// ICE servers configuration (STUN-only by default, TURN optional)
// STUN servers are sufficient for most use cases
// TURN servers are optional - only added if configured in constants.ts
const getIceServers = () => {
  const servers = [...WEBRTC_CONFIG.STUN_SERVERS];
  
  // Add TURN servers only if configured (optional)
  if (WEBRTC_CONFIG.TURN_SERVERS.length > 0) {
    servers.push(...WEBRTC_CONFIG.TURN_SERVERS);
  }
  
  return { iceServers: servers };
};

export const WebRTCProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { socket } = useSocket();
  const { user } = useUser();

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [call, setCall] = useState<Call>({});
  const [callAccepted, setCallAccepted] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  const [isCalling, setIsCalling] = useState(false);
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [isMuted, setIsMuted] = useState(false);
  const [isCameraOff, setIsCameraOff] = useState(false);
  const [connectionState, setConnectionState] = useState<string>('new');
  const [iceConnectionState, setIceConnectionState] = useState<string>('new');
  const [callDuration, setCallDuration] = useState<number>(0);
  const [pendingCancel, setPendingCancel] = useState<boolean>(false); // Track if cancel is in progress to prevent navigation

  const peerConnection = useRef<RTCPeerConnection | null>(null);
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
  const userIdRef = useRef<string | undefined>(user?._id); // Store user ID in ref for reliable checks
  const isAnsweringRef = useRef(false); // Prevent duplicate answer attempts
  const processingCallUserRef = useRef(false); // Prevent duplicate callUser event processing
  const processingCallCanceledRef = useRef(false); // Prevent duplicate CallCanceled event processing
  const callWasCanceledRef = useRef(false); // Track if call was canceled to ignore stale answers
  const lastProcessedSignalSdpRef = useRef<string | null>(null); // Track last processed signal SDP to prevent duplicates
  const requestSignalTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track requestSignal timeout to cancel it
  const hasRequestedSignalRef = useRef<{ callerId: string; timestamp: number } | null>(null); // Track if we've already requested signal for this call
  const receiverTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track receiver timeout - clears "Incoming call..." if no connection

  // Update user ID ref when user changes (for reliable checks in socket handlers)
  useEffect(() => {
    userIdRef.current = user?._id;
  }, [user?._id]);

  // Request permissions for camera and microphone (Android)
  const requestPermissions = async (requireCamera: boolean = true) => {
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
  };

  // Initialize media stream
  const getMediaStream = async (type: 'audio' | 'video') => {
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
      return stream;
    } catch (error) {
      console.error('Error getting media stream:', error);
      throw error;
    }
  };

  // Create peer connection with enhanced monitoring
  const createPeerConnection = (stream: MediaStream) => {
    const configuration = getIceServers();
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
          socket.emit('iceCandidate', {
            userToCall: targetUserId,
            candidate: event.candidate,
            from: currentUserId,
          });
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
      const state = pc.connectionState;
      setConnectionState(state);
      console.log(`📡 [WebRTC] Connection state: ${state}`);

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
          if (!callDurationIntervalRef.current) {
            // Reset callDuration to 0 to show "Connected" first
            setCallDuration(0);
            // Set start time to now
            const startTime = Date.now();
            callStartTimeRef.current = startTime;
            
            console.log('🕐 [WebRTC] Starting timer...', {
              userId: user?._id,
              isCaller: !call.isReceivingCall,
              startTime
            });
            
            // Start the interval - first update will happen after 1 second
            const intervalId = setInterval(() => {
              if (callStartTimeRef.current) {
                const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
                console.log('⏱️ [WebRTC] Timer tick:', duration, { userId: user?._id });
                setCallDuration(duration);
              } else {
                // If start time was cleared, stop the interval
                if (callDurationIntervalRef.current) {
                  clearInterval(callDurationIntervalRef.current);
                  callDurationIntervalRef.current = null;
                }
              }
            }, 1000);
            callDurationIntervalRef.current = intervalId;
            console.log('✅ [WebRTC] Call duration timer started (connection state)', {
              userId: user?._id,
              isCaller: !call.isReceivingCall,
              intervalId: intervalId.toString()
            });
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
          // CRITICAL: Set callEnded to true when connection closes to allow new calls
          // This ensures callAccepted doesn't block new calls after connection closes
          if (callAccepted || isCalling) {
            console.log('📴 [WebRTC] Connection closed - ending call and resetting state');
            setCallEnded(true);
            setCallAccepted(false);
            setIsCalling(false);
          }
          // Cleanup timers
          if (callDurationIntervalRef.current) {
            clearInterval(callDurationIntervalRef.current);
            callDurationIntervalRef.current = null;
          }
          if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
          }
          callStartTimeRef.current = null;
          setCallDuration(0);
          break;
      }
    };

    // Monitor ICE connection state (NAT traversal state)
    pc.oniceconnectionstatechange = () => {
      const state = pc.iceConnectionState;
      setIceConnectionState(state);
      console.log(`🧊 [WebRTC] ICE connection state: ${state}`);

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
            // Reset callDuration to 0 to show "Connected" first
            setCallDuration(0);
            // Set start time to now
            callStartTimeRef.current = Date.now();
            
            // Start the interval - first update will happen after 1 second
            const intervalId = setInterval(() => {
              if (callStartTimeRef.current) {
                const duration = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
                setCallDuration(duration);
              } else {
                if (callDurationIntervalRef.current) {
                  clearInterval(callDurationIntervalRef.current);
                  callDurationIntervalRef.current = null;
                }
              }
            }, 1000);
            callDurationIntervalRef.current = intervalId;
            console.log('✅ [WebRTC] Call duration timer started (from ICE connection state)', {
              userId: user?._id,
              isCaller: !call.isReceivingCall
            });
          }
          break;
        case 'failed':
          console.error('❌ [WebRTC] ICE connection failed');
          // If both ICE and connection states are failed, end the call
          if (pc.connectionState === 'failed') {
            console.error('❌ [WebRTC] Both ICE and connection failed, ending call');
            setTimeout(() => {
              if (peerConnection.current && 
                  (peerConnection.current.iceConnectionState === 'failed' || 
                   peerConnection.current.connectionState === 'failed')) {
                leaveCall();
              }
            }, 2000); // Give a brief moment for recovery attempt
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
    
    // Clear timers
    if (callDurationIntervalRef.current) {
      clearInterval(callDurationIntervalRef.current);
      callDurationIntervalRef.current = null;
    }
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
    
    // Close peer connection
    if (peerConnection.current) {
      try {
        // Remove all tracks before closing
        peerConnection.current.getSenders().forEach(sender => {
          if (sender.track) {
            sender.track.stop();
          }
        });
        peerConnection.current.getReceivers().forEach(receiver => {
          if (receiver.track) {
            receiver.track.stop();
          }
        });
        peerConnection.current.close();
      } catch (error) {
        console.error('❌ [WebRTC] Error closing peer connection:', error);
      }
      peerConnection.current = null;
    }
    
    // Stop and cleanup local stream
    if (localStream) {
      localStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      setLocalStream(null);
    }
    
    // Stop and cleanup remote stream
    if (remoteStream) {
      remoteStream.getTracks().forEach(track => {
        track.stop();
        track.enabled = false;
      });
      setRemoteStream(null);
    }
    
    // Reset state
    remoteUserIdRef.current = null;
    // NOTE: Don't clear persistentCallerIdRef here - it's needed for timeout handling
    // It will be cleared when starting a new call
    pendingIceCandidates.current = [];
    reconnectionAttempts.current = 0;
    callStartTimeRef.current = null;
    setCallDuration(0);
    setConnectionState('new');
    setIceConnectionState('new');
    
    console.log('✅ [WebRTC] Cleanup complete');
  };

  // Call user
  const callUser = async (userId: string, userName: string, type: 'audio' | 'video') => {
    try {
      console.log('═══════════════════════════════════════════════════════');
      console.log(`📞 [CallUser] ========== STARTING CALL ==========`);
      
      // CRITICAL: Reset cancel flag for NEW calls
      // This prevents stale pending cancels from interfering with new calls
      callWasCanceledRef.current = false;
      console.log('✅ [CallUser] Reset callWasCanceledRef for new call');
      console.log(`📞 [CallUser] Target: ${userName} (${userId})`);
      console.log(`📞 [CallUser] Type: ${type}`);
      console.log(`📞 [CallUser] Current user: ${user?._id}`);
      
      // CRITICAL: Reset call state when starting a new call, but DON'T clean up peer connection yet
      // The peer connection will be created fresh below, but we need to preserve it if a call is in progress
      // Only reset state flags, not the peer connection (it will be created/cleaned up as needed)
      setCallEnded(false); // Reset callEnded immediately to allow new call
      setCallAccepted(false);
      setIsCalling(false);
      setCall({});
      processingCallCanceledRef.current = false; // Allow new cancel events
      callWasCanceledRef.current = false; // CRITICAL: Reset cancellation flag for new call - allows answers to be processed
      persistentCallerIdRef.current = null; // Clear persistent caller ID for new call
      processingCallUserRef.current = false; // Reset to allow new call processing
      lastProcessedSignalSdpRef.current = null; // Clear last processed signal
      // DON'T clear remoteUserIdRef here - it will be set below
      // DON'T clear peerConnection here - it will be created fresh below
      pendingSignalRequestRef.current = null;
      hasRequestedSignalRef.current = null;
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      
      // Clean up any existing peer connection BEFORE creating a new one
      // This ensures we start fresh for the new call
      if (peerConnection.current) {
        console.log('🧹 [CallUser] Cleaning up existing peer connection before creating new one...');
        cleanupPeer();
      }
      
      // Clear any pending answer from previous call
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
        console.error('❌ [CallUser] Socket not connected! Cannot make call.');
        throw new Error('Socket not connected. Please wait for connection.');
      }
      
      remoteUserIdRef.current = userId;
      setCallType(type);
      setIsCalling(true);
      setCallEnded(false);
      
      console.log(`📞 [CallUser] Step 1: Getting media stream...`);
      const stream = await getMediaStream(type);
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
      const callData = {
        userToCall: userId,
        signalData: offer,
        from: user?._id,
        name: user?.name || user?.username,
        callType: type,
      };
      console.log(`📤 [CallUser] Emitting callUser:`, {
        userToCall: callData.userToCall,
        from: callData.from,
        name: callData.name,
        callType: callData.callType,
        hasSignal: !!callData.signalData,
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
        console.warn('⚠️ [AnswerCall] Call was already canceled - aborting answer');
        isAnsweringRef.current = false;
        cleanupPeer();
        setCallAccepted(false);
        throw new Error('Call was canceled before answer could complete');
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
      
      console.log(`📞 [AnswerCall] Step 1: Getting media stream...`);
      const stream = await getMediaStream(call.callType || 'video');
      console.log(`✅ [AnswerCall] Media stream obtained:`, {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });
      
      // CRITICAL: Double-check call wasn't canceled while getting media stream
      if (callWasCanceledRef.current) {
        console.warn('⚠️ [AnswerCall] Call was canceled while getting media stream - aborting');
        isAnsweringRef.current = false;
        cleanupPeer();
        setCallAccepted(false);
        throw new Error('Call was canceled during answer process');
      }
      
      console.log(`📞 [AnswerCall] Step 2: Creating peer connection...`);
      // Clear receiver timeout since we're now answering
      if (receiverTimeoutRef.current) {
        clearTimeout(receiverTimeoutRef.current);
        receiverTimeoutRef.current = null;
        console.log('✅ [AnswerCall] Receiver timeout cleared - call is being answered');
      }
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
          const answerData = {
            signal: answer,
            to: fromToUse,
          };
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
      console.error('❌ [AnswerCall] ========== ERROR ==========');
      console.error('❌ [AnswerCall] Error:', error);
      console.error('❌ [AnswerCall] Error message:', error?.message);
      console.error('❌ [AnswerCall] Error stack:', error?.stack);
      console.error('═══════════════════════════════════════════════════════');
      // Reset flag on error so we can retry (unless it's a closed state error)
      isAnsweringRef.current = false;
      if (error?.message?.includes('closed') || error?.message?.includes('wrong state')) {
        setCallAccepted(false);
      }
      cleanupPeer();
      setCallAccepted(false);
      remoteUserIdRef.current = null;
      throw error;
    }
  };

  // Leave call
  const leaveCall = () => {
    console.log('📴 [LeaveCall] Leaving call...');
    
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
      // Fallback to call.userToCall
      otherUserId = call.userToCall;
    } else if (call.from) {
      // Last resort: use call.from (should only happen for incoming calls)
      otherUserId = call.from;
    }
    
    // CRITICAL: Always emit cancelCall if there's an active call attempt
    // Check: isCalling, callAccepted, isReceivingCall, OR if remoteUserIdRef has a value (call was initiated)
    // This ensures the other user is notified when we cancel, even if call state is partial or being cleared
    const hasActiveCall = callAccepted || isCalling || call.isReceivingCall || !!remoteUserIdRef.current || !!otherUserId;
    
    // IMPORTANT: Emit cancelCall if we have any indication of an active call
    // This includes having otherUserId even if state flags are false (might be in cleanup transition)
    // Use userIdRef instead of user?._id for more reliability
    const currentUserId = userIdRef.current || user?._id;
    if (socket && otherUserId && currentUserId) {
      const cancelData = {
        conversationId: otherUserId,
        sender: currentUserId,
      };
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
        console.error('❌ [LeaveCall] Socket not connected - cannot emit cancelCall');
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
    
    cleanupPeer();
    setCallEnded(true);
    setCallAccepted(false);
    setIsCalling(false);
    setCall({});
    
    // Cancel requestSignal retry loop
    if (requestSignalTimeoutRef.current) {
      clearTimeout(requestSignalTimeoutRef.current);
      requestSignalTimeoutRef.current = null;
    }
    pendingSignalRequestRef.current = null;
    hasRequestedSignalRef.current = null;
    
    // Reset processing flags to allow new calls
    processingCallUserRef.current = false;
    processingCallCanceledRef.current = false;
    lastProcessedSignalSdpRef.current = null;
    
    // CRITICAL: Reset remoteUserIdRef to allow new calls after cancel
    remoteUserIdRef.current = null;
    
    setTimeout(() => {
      setCallEnded(false);
    }, 500);
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
    
    // CRITICAL: Store caller ID persistently for timeout handling
    persistentCallerIdRef.current = callerId;
    
    // Check if we've already requested signal for this caller recently (within last 5 seconds)
    // Do this FIRST to prevent duplicate processing
    const now = Date.now();
    if (hasRequestedSignalRef.current && 
        hasRequestedSignalRef.current.callerId === callerId && 
        (now - hasRequestedSignalRef.current.timestamp) < 5000) {
      console.log('⚠️ [NotificationCall] Already requested signal for this caller recently - skipping');
      // But still set up the call state in case signal is already available
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
      console.log('✅ [NotificationCall] Marked for auto-answer:', callerId);
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
        // This handles cases where backend can't find the call or signal is lost
        if (requestSignalTimeoutRef.current) {
          clearTimeout(requestSignalTimeoutRef.current);
        }
        requestSignalTimeoutRef.current = setTimeout(() => {
          // Check if we still don't have the signal
          if (pendingSignalRequestRef.current && 
              pendingSignalRequestRef.current.callerId === callerId &&
              !call.signal) {
            console.warn('⚠️ [NotificationCall] Signal request timeout - retrying...');
            // Retry the request
            if (socket?.isSocketConnected?.()) {
              socket.emit('requestCallSignal', {
                callerId: callerId,
                receiverId: currentUserId,
              });
              console.log('🔄 [NotificationCall] Signal request retried');
            }
          }
          requestSignalTimeoutRef.current = null;
        }, 5000); // 5 second timeout
      } catch (error) {
        console.error('❌ [NotificationCall] Error emitting requestCallSignal:', error);
        // Store as pending if socket not ready
        if (user) {
          pendingSignalRequestRef.current = { callerId, receiverId: user._id };
        }
      }
    } else {
      // Socket not connected yet - store as pending
      if (user && !pendingSignalRequestRef.current) {
        pendingSignalRequestRef.current = { callerId, receiverId: user._id };
        console.log('⏳ [NotificationCall] Socket not connected - will request when connected');
      }
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
    // This ensures we don't accumulate listeners if useEffect runs multiple times
    socket.off('callUser');
    socket.off('callAccepted');
    socket.off('iceCandidate');
    socket.off('CallCanceled');
    socket.off('callBusyError');
    
    const socketInstance = socket.getSocket();
    if (socketInstance) {
      // Remove any existing connect listener first
      socketInstance.off('connect');
      
      const onConnect = () => {
        // Only emit requestCallSignal if we don't already have a signal and haven't already sent a request recently
        if (pendingSignalRequestRef.current && user) {
          const { callerId } = pendingSignalRequestRef.current;
          const now = Date.now();
          
          // Check if we've already requested recently for this caller
          if (hasRequestedSignalRef.current && 
              hasRequestedSignalRef.current.callerId === callerId && 
              (now - hasRequestedSignalRef.current.timestamp) < 5000) {
            console.log('⚠️ [WebRTC] Already requested signal recently - skipping duplicate request');
            return;
          }
          
          console.log('📡 [WebRTC] Socket connected - sending pending signal request');
          socket.emit('requestCallSignal', pendingSignalRequestRef.current);
          // Mark that we've requested signal
          hasRequestedSignalRef.current = { callerId, timestamp: now };
          // Keep pendingSignalRequestRef to prevent duplicate requests until signal received
        }
      };
      
      // Only set up connect listener if socket is not already connected
      if (!socketInstance.connected) {
        socketInstance.once('connect', onConnect);
      } else {
        // Socket already connected, call once
        onConnect();
      }
    }
    
    // Incoming call
    console.log('🔔 [WebRTC] Registering callUser socket listener...');
    socket.on('callUser', async (data: any) => {
      // CRITICAL: Prevent duplicate processing - check ref first
      if (processingCallUserRef.current) {
        console.log('⚠️ [IncomingCall] Already processing callUser event - ignoring duplicate');
        return;
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
      
      // Prevent duplicate processing - if we're already receiving this exact call, ignore
      // CRITICAL: Check BEFORE setting state to prevent race conditions
      if (call.isReceivingCall && call.from === data.from) {
        console.log('⚠️ [IncomingCall] Ignoring duplicate callUser event for same call');
        console.log('⚠️ [IncomingCall] Already receiving call from:', call.from);
        console.log('⚠️ [IncomingCall] Current callAccepted:', callAccepted);
        return;
      }
      
      // Check if this is the exact same signal we've already processed
      if (data.signal && data.signal.sdp) {
        const signalSdp = data.signal.sdp;
        if (lastProcessedSignalSdpRef.current === signalSdp) {
          console.log('⚠️ [IncomingCall] Ignoring duplicate signal - same SDP already processed');
          return;
        }
      }
      
      // Also check if we're already answering this call
      if (callAccepted && call.from === data.from) {
        console.log('⚠️ [IncomingCall] Call already accepted - ignoring duplicate event');
        return;
      }
      
      // CRITICAL: Security/Isolation check - only process calls intended for this user
      // Backend uses io.to(receiverSocketId) but we add this as defense in depth
      const currentUserId = userIdRef.current || user?._id;
      if (data.userToCall && data.userToCall !== currentUserId) {
        console.log('⚠️ [IncomingCall] Ignoring call - not intended for this user');
        console.log('⚠️ [IncomingCall] Reason:', {
          'data.userToCall': data.userToCall,
          'currentUserId': currentUserId,
          'userIdRef.current': userIdRef.current,
          'user?._id': user?._id,
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
      const wasAlreadyReceiving = call.isReceivingCall && call.from === data.from;
      const shouldAutoAnswer = shouldAutoAnswerFromRef || wasAlreadyReceiving;
      
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
      
      // Track processed signal SDP to prevent duplicates
      if (data.signal && data.signal.sdp) {
        lastProcessedSignalSdpRef.current = data.signal.sdp;
      }
      
      // Cancel requestSignal retry loop since signal is received
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      pendingSignalRequestRef.current = null;
      // Clear hasRequestedSignalRef so we can request again if needed for a new call
      if (hasRequestedSignalRef.current?.callerId === data.from) {
        hasRequestedSignalRef.current = null;
      }
      
      console.log('✅ [IncomingCall] Call state set:', incomingCallState);
      
      // Auto-answer if Answer button was pressed
      if (shouldAutoAnswer && data.signal && !callAccepted) {
        console.log('📞 [IncomingCall] Auto-answering call...');
        shouldAutoAnswerRef.current = null;
        // Pass data.signal and data.from directly to avoid race condition with setCall() state update
        setTimeout(async () => {
          try {
            await answerCall(data.signal, data.from);
          } catch (err) {
            console.error('❌ [IncomingCall] Error auto-answering call:', err);
            shouldAutoAnswerRef.current = data.from;
          }
        }, 300);
      } else if (shouldAutoAnswer && !data.signal) {
        console.log('📞 [IncomingCall] Requesting call signal (no signal in data)');
        if (socket?.connected && !pendingSignalRequestRef.current) {
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
            console.warn('⚠️ [IncomingCall] Receiver timeout - no connection established, clearing call state');
            console.warn('⚠️ [IncomingCall] This prevents stuck "Incoming call..." UI');
            
            // CRITICAL: Dismiss native notification/IncomingCallActivity to close the UI
            try {
              const { NativeModules } = require('react-native');
              const { CallDataModule } = NativeModules;
              if (CallDataModule && CallDataModule.dismissCallNotification) {
                CallDataModule.dismissCallNotification().then(() => {
                  console.log('✅ [IncomingCall] Native notification/UI dismissed due to timeout');
                }).catch((error: any) => {
                  console.warn('⚠️ [IncomingCall] Could not dismiss notification:', error);
                });
              }
            } catch (error) {
              console.warn('⚠️ [IncomingCall] Could not dismiss notification:', error);
            }
            
            // Clear the incoming call state
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
            
            // CRITICAL: Notify caller that receiver timed out - this ensures caller also clears their UI
            if (socket?.isSocketConnected?.() && data.from && userIdRef.current) {
              console.log('📤 [IncomingCall] Notifying caller about receiver timeout');
              socket.emit('cancelCall', {
                conversationId: data.from,
                sender: userIdRef.current,
              });
              console.log('✅ [IncomingCall] cancelCall event sent to caller');
            } else {
              console.warn('⚠️ [IncomingCall] Cannot notify caller - missing requirements:', {
                hasSocket: !!socket,
                isConnected: socket?.isSocketConnected?.(),
                callerId: data.from,
                currentUserId: userIdRef.current,
              });
            }
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

    // Call answered
    socket.on('callAccepted', async (signal: any) => {
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

    // ICE candidate received (Trickle ICE - process immediately)
    socket.on('iceCandidate', async (data: any) => {
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

    // Call canceled
    socket.on('CallCanceled', () => {
      // Prevent duplicate processing - check ref FIRST before any async operations
      if (processingCallCanceledRef.current) {
        console.log('⚠️ [WebRTC] Already processing CallCanceled - ignoring duplicate');
        return;
      }
      
      // OPTIMIZATION: If call already ended naturally, skip processing to avoid redundant cleanup
      // This prevents duplicate state resets and navigation when call ends naturally then cancel arrives
      if (callEnded && !isCalling && !callAccepted) {
        console.log('✅ [WebRTC] Call already ended - skipping CallCanceled processing (optimization)');
        return;
      }
      
      // CRITICAL: Set flag IMMEDIATELY to prevent duplicate processing
      processingCallCanceledRef.current = true;
      callWasCanceledRef.current = true; // Mark that call was canceled to ignore stale answers
      
      console.log('📴 [WebRTC] ========== CALL CANCELED RECEIVED ==========');
      console.log('📴 [WebRTC] Other user canceled the call');
      
      // CRITICAL: Dismiss native notification/IncomingCallActivity to close the UI
      // This ensures the "Incoming call..." screen closes when the call is canceled
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
      
      // Clean up peer connection (only if not already cleaned up)
      if (peerConnection.current) {
        cleanupPeer();
      }
      
      // Reset all call state (only if not already reset)
      // CRITICAL: Always clear isReceivingCall to prevent stuck "Incoming call..." UI
      if (!callEnded || isCalling || callAccepted || call.isReceivingCall) {
        setCallEnded(true);
        setCallAccepted(false);
        setIsCalling(false);
        setCall({
          isReceivingCall: false,
          from: undefined,
          userToCall: undefined,
          name: undefined,
          signal: undefined,
          callType: 'audio',
        });
      }
      setPendingCancel(false); // Reset pendingCancel flag
      
      // Cancel requestSignal retry loop
      if (requestSignalTimeoutRef.current) {
        clearTimeout(requestSignalTimeoutRef.current);
        requestSignalTimeoutRef.current = null;
      }
      // Clear receiver timeout
      if (receiverTimeoutRef.current) {
        clearTimeout(receiverTimeoutRef.current);
        receiverTimeoutRef.current = null;
      }
      pendingSignalRequestRef.current = null;
      hasRequestedSignalRef.current = null;
      
      // CRITICAL: Reset processingCallUserRef to allow new calls after cancellation
      // If this was set during callUser processing, it would block future calls
      processingCallUserRef.current = false;
      lastProcessedSignalSdpRef.current = null;
      remoteUserIdRef.current = null;
      
      console.log('✅ [WebRTC] Call state cleared after cancellation');
      console.log('✅ [WebRTC] State after cancel:', {
        callEnded: true,
        isCalling: false,
        callAccepted: false,
        call: {}
      });
      
      // OPTIMIZATION: Reset callEnded immediately (not after delay) to allow immediate re-calling
      // This ensures smooth call-cancel-call again flow for 1M+ users
      // The UI will still show "Call ended" briefly, but new calls can start immediately
      setCallEnded(false);
      
      // CRITICAL: Reset processing flag after a short delay to prevent duplicate events
      // But keep it true long enough to block rapid duplicate CallCanceled events
      setTimeout(() => {
        processingCallCanceledRef.current = false; // Allow new cancel events after delay
        console.log('✅ [WebRTC] Call ended flag reset immediately - ready for new calls');
        console.log('✅ [WebRTC] Processing flag reset - ready for new cancel events');
      }, 1000); // 1 second delay to prevent duplicate processing
    });

    // User busy error
    socket.on('callBusyError', (data: any) => {
      cleanupPeer();
      setIsCalling(false);
      setCallEnded(true);
    });

    // Handle resendCallSignal request from backend (when signal request fails)
    socket.on('resendCallSignal', async ({ receiverId }: { receiverId: string }) => {
      console.log('📞 [ResendCallSignal] Backend requested to re-send call signal');
      console.log('📞 [ResendCallSignal] Receiver ID:', receiverId);
      
      // Only re-send if we're currently calling this user
      if (isCalling && remoteUserIdRef.current === receiverId && call.signal) {
        console.log('✅ [ResendCallSignal] Re-sending call signal to:', receiverId);
        socket.emit('callUser', {
          userToCall: receiverId,
          from: user?._id || userIdRef.current,
          name: user?.name || 'Unknown',
          signal: call.signal,
          callType: call.callType || 'video',
        });
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

    return () => {
      console.log('🧹 [WebRTC] Cleaning up socket listeners...');
      socket.off('callUser');
      socket.off('callAccepted');
      socket.off('iceCandidate');
      socket.off('CallCanceled');
      socket.off('callBusyError');
      socket.off('resendCallSignal');
    };
  }, [socket, user]); // Depend on socket and user object (like thredmobile)

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
      console.log('✅ [WebRTC] Call state cleared - navigation prevented');
      
      // Then emit cancelCall socket event to notify the caller
      if (socket && socket.isSocketConnected() && data.callerId && user?._id) {
        const cancelData = {
          conversationId: data.callerId,
          sender: user._id,
        };
        
        console.log('📴 [WebRTC] Emitting cancelCall event:', cancelData);
        socket.emit('cancelCall', cancelData);
        console.log('✅ [WebRTC] cancelCall event emitted to backend');
        
        // Clear SharedPreferences to prevent AppNavigator from seeing pending cancel
        clearCallData().then(() => {
          console.log('✅ [WebRTC] SharedPreferences cleared');
        }).catch((error) => {
          console.error('❌ [WebRTC] Error clearing SharedPreferences:', error);
        });
        
        // Reset pendingCancel after a short delay to allow navigation for new calls
        setTimeout(() => {
          setPendingCancel(false);
          console.log('✅ [WebRTC] pendingCancel flag reset - navigation allowed again');
        }, 1000);
      } else {
        console.error('❌ [WebRTC] Cannot emit cancelCall - missing requirements:', {
          hasSocket: !!socket,
          socketConnected: socket?.isSocketConnected?.(),
          callerId: data.callerId,
          userId: user?._id,
        });
        // Clear SharedPreferences even if emit failed
        clearCallData().then(() => {
          console.log('✅ [WebRTC] SharedPreferences cleared (emit failed)');
        }).catch((error) => {
          console.error('❌ [WebRTC] Error clearing SharedPreferences:', error);
        });
        
        // Reset pendingCancel even if emit failed
        setTimeout(() => {
          setPendingCancel(false);
        }, 1000);
      }
    });
    
    return () => {
      console.log('🧹 [WebRTC] Cleaning up CancelCallFromNotification listener...');
      cancelCallListener.remove();
    };
  }, [socket, user?._id]); // Depend on socket and user._id

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

        // CRITICAL: Check if callWasCanceledRef was reset (new call arrived)
        // If it was reset to false, a new call from this caller arrived, so ignore this stale cancel
        if (!callWasCanceledRef.current) {
          console.log('⚠️ [WebRTC] Stale pending cancel detected - new call arrived, ignoring cancel', {
            pendingCancelCaller: callerIdToCancel,
            callWasCanceledRef: callWasCanceledRef.current,
          });
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

  return (
    <WebRTCContext.Provider
      value={{
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
        isMuted,
        isCameraOff,
        connectionState,
        iceConnectionState,
        callDuration,
        pendingCancel,
        setIncomingCallFromNotification,
      }}
    >
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
