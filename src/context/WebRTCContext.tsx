import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import {
  RTCPeerConnection,
  RTCSessionDescription,
  RTCIceCandidate,
  mediaDevices,
  MediaStream,
} from 'react-native-webrtc';
import { Platform, PermissionsAndroid } from 'react-native';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import fcmService from '../services/fcmService';
import { WEBRTC_CONFIG } from '../utils/constants';

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

  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const remoteUserIdRef = useRef<string | null>(null);
  const pendingIceCandidates = useRef<RTCIceCandidate[]>([]);
  const shouldAutoAnswerRef = useRef<string | null>(null);
  const pendingSignalRequestRef = useRef<{ callerId: string; receiverId: string } | null>(null);
  const reconnectionAttempts = useRef<number>(0);
  const callStartTimeRef = useRef<number | null>(null);
  const callDurationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const iceDisconnectedTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track ICE disconnected timeout
  const userIdRef = useRef<string | undefined>(user?._id); // Store user ID in ref for reliable checks
  const isAnsweringRef = useRef(false); // Prevent duplicate answer attempts
  const processingCallUserRef = useRef(false); // Prevent duplicate callUser event processing
  const processingCallCanceledRef = useRef(false); // Prevent duplicate CallCanceled event processing
  const lastProcessedSignalSdpRef = useRef<string | null>(null); // Track last processed signal SDP to prevent duplicates
  const requestSignalTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Track requestSignal timeout to cancel it
  const hasRequestedSignalRef = useRef<{ callerId: string; timestamp: number } | null>(null); // Track if we've already requested signal for this call

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
        console.log('🧊 [WebRTC] ICE candidate generated:', {
          type: event.candidate.type,
          candidate: event.candidate.candidate?.substring(0, 50) + '...',
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        });
        console.log('🧊 [WebRTC] Sending ICE candidate to:', remoteUserIdRef.current);
        socket.emit('iceCandidate', {
          userToCall: remoteUserIdRef.current,
          candidate: event.candidate,
          from: user?._id,
        });
        console.log('✅ [WebRTC] ICE candidate sent');
      } else if (!event.candidate) {
        console.log('✅ [WebRTC] ICE candidate gathering complete (null candidate received)');
      } else {
        console.log('⚠️ [WebRTC] ICE candidate generated but missing requirements:', {
          hasCandidate: !!event.candidate,
          hasSocket: !!socket,
          remoteUserId: remoteUserIdRef.current,
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
          // Start call duration timer
          if (!callStartTimeRef.current) {
            callStartTimeRef.current = Date.now();
            callDurationIntervalRef.current = setInterval(() => {
              if (callStartTimeRef.current) {
                setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
              }
            }, 1000);
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
        const otherUserId = call.isReceivingCall ? call.from : call.userToCall;
        if (socket && otherUserId && user?._id) {
          console.log('📤 [WebRTC] Notifying other user about connection timeout');
          socket.emit('cancelCall', {
            conversationId: otherUserId,
            sender: user._id,
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
      console.log(`📞 [CallUser] Target: ${userName} (${userId})`);
      console.log(`📞 [CallUser] Type: ${type}`);
      console.log(`📞 [CallUser] Current user: ${user?._id}`);
      
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
      
      remoteUserIdRef.current = fromToUse;
      setCallAccepted(true); // Set this FIRST to prevent duplicate calls
      setIsCalling(false);
      setCallEnded(false);
      
      // Hide FCM notification when answering
      // Native IncomingCallActivity handles notification hiding
      
      console.log(`📞 [AnswerCall] Step 1: Getting media stream...`);
      const stream = await getMediaStream(call.callType || 'video');
      console.log(`✅ [AnswerCall] Media stream obtained:`, {
        audioTracks: stream.getAudioTracks().length,
        videoTracks: stream.getVideoTracks().length,
      });
      
      console.log(`📞 [AnswerCall] Step 2: Creating peer connection...`);
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
    
    // Determine other user ID - prioritize isCalling state and remoteUserIdRef
    // If we're calling (outgoing), use call.userToCall or remoteUserIdRef
    // If we're receiving (incoming), use call.from
    // remoteUserIdRef is the most reliable as it persists even if call state is cleared
    let otherUserId: string | null | undefined = null;
    
    if (isCalling && remoteUserIdRef.current) {
      // We're making an outgoing call - use remoteUserIdRef (most reliable)
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
    if (socket && otherUserId && user?._id) {
      const cancelData = {
        conversationId: otherUserId,
        sender: user._id,
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
        userId: user?._id,
        hasActiveCall,
        callAccepted,
        isCalling,
        isReceivingCall: call.isReceivingCall,
        remoteUserIdRef: remoteUserIdRef.current,
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
    
    // Check if we've already requested signal for this caller recently (within last 5 seconds)
    // Do this FIRST to prevent duplicate processing
    const now = Date.now();
    if (hasRequestedSignalRef.current && 
        hasRequestedSignalRef.current.callerId === callerId && 
        (now - hasRequestedSignalRef.current.timestamp) < 5000) {
      console.log('⚠️ [NotificationCall] Already requested signal for this caller recently - skipping');
      return;
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
    
    if (isConnected && user) {
      // Emit request only once
      console.log('📡 [NotificationCall] ✅ Socket connected! Requesting call signal...');
      try {
        socket.emit('requestCallSignal', {
          callerId: callerId,
          receiverId: user._id,
        });
        // Mark that we've requested signal for this caller
        hasRequestedSignalRef.current = { callerId, timestamp: now };
        pendingSignalRequestRef.current = { callerId, receiverId: user._id };
        console.log('✅ [NotificationCall] Signal request sent - waiting for response via callUser event');
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
      // Additional check: if we're making a call and remoteUserIdRef matches, it's also our echo
      const fromMatchesOurId = data.from === userIdRef.current || (user?._id && data.from === user._id);
      const isOurOutgoingCallEcho = isCalling && remoteUserIdRef.current && remoteUserIdRef.current === data.userToCall;
      
      // DEBUG: Log echo check details BEFORE processing
      console.log('🔍 [IncomingCall] Echo check:', {
        'data.from': data.from,
        'userIdRef.current': userIdRef.current,
        'user?._id': user?._id,
        'fromMatchesOurId': fromMatchesOurId,
        'isCalling': isCalling,
        'remoteUserIdRef.current': remoteUserIdRef.current,
        'data.userToCall': data.userToCall,
        'isOurOutgoingCallEcho': isOurOutgoingCallEcho,
      });
      
      if (fromMatchesOurId) {
        // This is our own echo - we can't receive calls from ourselves
        console.log('⚠️ [IncomingCall] Ignoring - this is our own call echo (from matches our ID)');
        return;
      }
      
      if (isOurOutgoingCallEcho) {
        // This is an echo of our outgoing call - ignore it
        console.log('⚠️ [IncomingCall] Ignoring - this is an echo of our outgoing call');
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
      
      setCallAccepted(true);
      setIsCalling(false);
      
      if (peerConnection.current && signal) {
        try {
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
          console.error('❌ [CallAccepted] Error setting remote description:', error);
          console.error('❌ [CallAccepted] Error message:', error?.message);
          console.error('❌ [CallAccepted] Error stack:', error?.stack);
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
      // Prevent duplicate processing
      if (processingCallCanceledRef.current) {
        console.log('⚠️ [WebRTC] Already processing CallCanceled - ignoring duplicate');
        return;
      }
      
      processingCallCanceledRef.current = true;
      
      console.log('📴 [WebRTC] ========== CALL CANCELED RECEIVED ==========');
      console.log('📴 [WebRTC] Other user canceled the call');
      
      // Hide FCM notification (important for incoming call UI)
      // Native IncomingCallActivity handles notification hiding
      
      // Clean up peer connection
      cleanupPeer();
      
      // Reset all call state
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
      
      // CRITICAL: Reset processingCallUserRef to allow new calls after cancellation
      // If this was set during callUser processing, it would block future calls
      processingCallUserRef.current = false;
      lastProcessedSignalSdpRef.current = null;
      remoteUserIdRef.current = null;
      
      // Reset call ended flag after a short delay
      setTimeout(() => {
        setCallEnded(false);
        processingCallCanceledRef.current = false; // Allow new cancel events
      }, 1000);
      
      console.log('✅ [WebRTC] Call state cleared after cancellation');
    });

    // User busy error
    socket.on('callBusyError', (data: any) => {
      cleanupPeer();
      setIsCalling(false);
      setCallEnded(true);
    });

    return () => {
      console.log('🧹 [WebRTC] Cleaning up socket listeners...');
      socket.off('callUser');
      socket.off('callAccepted');
      socket.off('iceCandidate');
      socket.off('CallCanceled');
      socket.off('callBusyError');
    };
  }, [socket, user]); // Depend on socket and user object (like thredmobile)

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
