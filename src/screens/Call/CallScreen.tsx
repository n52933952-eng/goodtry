import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
} from 'react-native';
import { RTCView } from 'react-native-webrtc';
import { useWebRTC } from '../../context/WebRTCContext';
import { COLORS } from '../../utils/constants';

const { width, height } = Dimensions.get('window');

interface CallScreenProps {
  navigation: any;
  route: any;
}

const CallScreen: React.FC<CallScreenProps> = ({ navigation, route }) => {
  const {
    localStream,
    remoteStream,
    callAccepted,
    callEnded,
    callType,
    call,
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
  } = useWebRTC();

  const { userName, userId, callType: routeCallType, isFromNotification, shouldAutoAnswer } = route.params || {};

  useEffect(() => {
    console.log('📞 [CallScreen] ========== CALLSCREEN MOUNTED ==========');
    console.log('📞 [CallScreen] Route params:', JSON.stringify(route.params || {}));
    console.log('📞 [CallScreen] isFromNotification:', isFromNotification);
    console.log('📞 [CallScreen] shouldAutoAnswer:', shouldAutoAnswer);
  }, []);

  // Handle notification-triggered calls OR shouldAutoAnswer from route params
  // This must happen BEFORE socket callUser event arrives to set shouldAutoAnswerRef
  const hasSetCallFromNotification = useRef(false); // Prevent duplicate calls
  useEffect(() => {
    // Only set up once - prevent infinite loop
    if (hasSetCallFromNotification.current) {
      return;
    }
    
    // If shouldAutoAnswer=true in route params (from MainActivity NavigateToCallScreen event)
    // OR if isFromNotification=true, set up the call state
    if ((shouldAutoAnswer || isFromNotification) && userId && userName && routeCallType) {
      console.log('🔥🔥🔥 [CallScreen] Setting up call from notification/auto-answer');
      console.log('📞 [CallScreen] shouldAutoAnswer from route:', shouldAutoAnswer);
      console.log('📞 [CallScreen] isFromNotification:', isFromNotification);
      
      // Mark that we've set this up to prevent duplicate calls
      hasSetCallFromNotification.current = true;
      
      // Always use shouldAutoAnswer value from route params
      // This ensures shouldAutoAnswerRef is set if shouldAutoAnswer=true
      setIncomingCallFromNotification(userId, userName, routeCallType, shouldAutoAnswer || false);
      console.log('✅ [CallScreen] Call state set up with shouldAutoAnswer:', shouldAutoAnswer || false);
    }
  }, [shouldAutoAnswer, isFromNotification, userId, userName, routeCallType, setIncomingCallFromNotification]);

  // Auto-answer if user clicked Answer button from notification (shouldAutoAnswer from route params)
  // This handles the case when socket event hasn't arrived yet or when signal is ready
  const hasAttemptedAnswerRef = useRef(false); // Prevent duplicate answer attempts
  useEffect(() => {
    // CRITICAL: Guard at the start - if already accepted or already attempted, return immediately
    if (callAccepted) {
      hasAttemptedAnswerRef.current = false; // Reset when call ends/accepts
      return;
    }
    
    // CRITICAL: If already attempted, don't try again
    if (hasAttemptedAnswerRef.current) {
      return;
    }
    
    // Only proceed if shouldAutoAnswer is true
    if (!shouldAutoAnswer) {
      return;
    }
    
    // CRITICAL: Prevent infinite loops - check guards BEFORE any processing
    if (callAccepted || hasAttemptedAnswerRef.current) {
      // Already answered or attempting - do nothing
      return;
    }
    
    console.log('📞 [CallScreen] ========== AUTO-ANSWER CHECK ==========');
    console.log('📞 [CallScreen] shouldAutoAnswer=true in route params');
    console.log('📞 [CallScreen] Call state:', { 
      isReceivingCall: call.isReceivingCall, 
      hasSignal: !!call.signal, 
      from: call.from, 
      userId,
      callAccepted,
      callType: call.callType,
      hasAttempted: hasAttemptedAnswerRef.current
    });
    
    // If call state is set and signal is available, answer immediately
    if (call.signal && call.from === userId) {
      console.log('✅✅✅ [CallScreen] Signal available AND call.from matches - auto-answering NOW...');
      hasAttemptedAnswerRef.current = true; // Mark as attempted IMMEDIATELY (BEFORE async call)
      setTimeout(() => {
        answerCall().catch(err => {
          console.error('❌ [CallScreen] Error answering call:', err);
          hasAttemptedAnswerRef.current = false; // Allow retry on error
        });
      }, 300);
      return;
    }
    
    // If call state is set but no signal yet, wait for signal (only once)
    if (call.isReceivingCall && call.from === userId && !call.signal) {
        console.log('⏳ [CallScreen] Call state set, waiting for signal to arrive...');
        hasAttemptedAnswerRef.current = true; // Mark as attempted to prevent duplicate intervals
        let attempts = 0;
        const maxAttempts = 100; // 10 seconds (increased timeout)
        
        const checkSignal = setInterval(() => {
          attempts++;
          
          // Use latest values from context, not closure
          // Once signal arrives, answer (only if not already accepted)
          if (call.signal && call.from === userId && !callAccepted) {
            console.log('✅✅✅ [CallScreen] Signal arrived - auto-answering NOW...');
            answerCall().catch(err => {
              console.error('❌ [CallScreen] Error answering call:', err);
              hasAttemptedAnswerRef.current = false; // Allow retry on error
            });
            clearInterval(checkSignal);
          } else if (attempts >= maxAttempts) {
            console.error('❌ [CallScreen] Timeout waiting for call signal after', maxAttempts * 100, 'ms');
            hasAttemptedAnswerRef.current = false; // Reset on timeout
            clearInterval(checkSignal);
          }
        }, 100);
        
        return () => {
          clearInterval(checkSignal);
        };
    }
    
    // If call state not set yet, wait for it to be set (only once)
    if (!call.isReceivingCall || call.from !== userId) {
        console.log('⏳ [CallScreen] Waiting for call state to be set...');
        console.log('⏳ [CallScreen] shouldAutoAnswerRef should be set, WebRTCContext will auto-answer when callUser event arrives');
        hasAttemptedAnswerRef.current = true; // Mark as attempted to prevent duplicate intervals
        
        // Also set up a check to auto-answer once call state is set
        let attempts = 0;
        const maxAttempts = 100;
        
        const checkCallState = setInterval(() => {
          attempts++;
          
          // Use latest values from context, not closure
          // Once call state is set with signal, answer immediately (only if not already accepted)
          if (call.isReceivingCall && call.from === userId && call.signal && !callAccepted) {
            console.log('✅✅✅ [CallScreen] Call state set with signal - auto-answering NOW...');
            answerCall().catch(err => {
              console.error('❌ [CallScreen] Error answering call:', err);
              hasAttemptedAnswerRef.current = false; // Allow retry on error
            });
            clearInterval(checkCallState);
          } else if (attempts >= maxAttempts) {
            console.error('❌ [CallScreen] Timeout waiting for call state');
            hasAttemptedAnswerRef.current = false; // Reset on timeout
            clearInterval(checkCallState);
          }
        }, 100);
        
        return () => {
          clearInterval(checkCallState);
        };
      }
    // Only depend on values that should trigger the effect, NOT answerCall (which is stable)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoAnswer, call.isReceivingCall, call.signal, call.from, call.callType, callAccepted, userId]);

  useEffect(() => {
    if (callEnded) {
      navigation.goBack();
    }
  }, [callEnded, navigation]);

  const handleLeaveCall = () => {
    leaveCall();
    navigation.goBack();
  };

  // Format call duration (seconds to MM:SS)
  const formatCallDuration = (seconds: number): string => {
    if (seconds === 0) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Get connection status text
  const getConnectionStatus = (): string => {
    if (!callAccepted) {
      if (call.isReceivingCall) {
        return 'Incoming call...';
      }
      return 'Connecting...';
    }
    
    if (connectionState === 'connected' && iceConnectionState === 'connected') {
      return callDuration > 0 ? formatCallDuration(callDuration) : 'Connected';
    }
    
    if (connectionState === 'connecting' || iceConnectionState === 'checking') {
      return 'Connecting...';
    }
    
    if (connectionState === 'failed' || iceConnectionState === 'failed') {
      return 'Connection failed';
    }
    
    if (iceConnectionState === 'disconnected') {
      return 'Reconnecting...';
    }
    
    return 'Connected';
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />

      {/* Remote Video (Full Screen) */}
      {callAccepted && remoteStream && callType === 'video' ? (
        <RTCView
          streamURL={remoteStream.toURL()}
          style={styles.remoteVideo}
          objectFit="cover"
          zOrder={0}
        />
      ) : (
          <View style={styles.placeholderContainer}>
          <View style={styles.avatarLarge}>
            <Text style={styles.avatarTextLarge}>
              {(call.isReceivingCall ? call.name : userName)?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
          <Text style={styles.userName}>
            {call.isReceivingCall ? call.name : userName || 'User'}
          </Text>
          <Text style={styles.statusText}>
            {getConnectionStatus()}
          </Text>
        </View>
      )}

      {/* Local Video (Picture in Picture) */}
      {localStream && callType === 'video' && !isCameraOff && (
        <View style={styles.localVideoContainer}>
          <RTCView
            streamURL={localStream.toURL()}
            style={styles.localVideo}
            objectFit="cover"
            zOrder={1}
            mirror={true}
          />
        </View>
      )}

      {/* Call Controls */}
      <View style={styles.controlsContainer}>
        <View style={styles.controls}>
          {/* Show Answer/Decline buttons for incoming calls */}
          {call.isReceivingCall && !callAccepted ? (
            <>
              <TouchableOpacity
                style={[styles.controlButton, styles.answerButton]}
                onPress={() => {
                  console.log('✅ [CallScreen] Answer button pressed');
                  answerCall().catch(err => {
                    console.error('❌ [CallScreen] Error answering call:', err);
                  });
                }}
              >
                <Text style={styles.controlIcon}>✅</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.controlButton, styles.declineButton]}
                onPress={handleLeaveCall}
              >
                <Text style={styles.controlIcon}>❌</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* Regular call controls (mute, camera, etc.) */}
              <TouchableOpacity
                style={[styles.controlButton, isMuted && styles.controlButtonActive]}
                onPress={toggleMute}
              >
                <Text style={styles.controlIcon}>{isMuted ? '🔇' : '🎤'}</Text>
              </TouchableOpacity>

              {callType === 'video' && (
                <>
                  <TouchableOpacity
                    style={[styles.controlButton, isCameraOff && styles.controlButtonActive]}
                    onPress={toggleCamera}
                  >
                    <Text style={styles.controlIcon}>{isCameraOff ? '📷' : '📹'}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.controlButton}
                    onPress={switchCamera}
                  >
                    <Text style={styles.controlIcon}>🔄</Text>
                  </TouchableOpacity>
                </>
              )}

              <TouchableOpacity
                style={[styles.controlButton, styles.endCallButton]}
                onPress={handleLeaveCall}
              >
                <Text style={styles.controlIcon}>📞</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Call Info Overlay */}
      <View style={styles.topOverlay}>
        <Text style={styles.callTypeText}>
          {callType === 'video' ? '📹 Video Call' : '📞 Voice Call'}
        </Text>
        <Text style={styles.durationText}>
          {getConnectionStatus()}
        </Text>
        {(connectionState === 'failed' || iceConnectionState === 'failed') && (
          <Text style={styles.errorText}>
            Connection issue - trying to reconnect...
          </Text>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  remoteVideo: {
    width: width,
    height: height,
  },
  placeholderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  avatarLarge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarTextLarge: {
    fontSize: 48,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 28,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 8,
  },
  statusText: {
    fontSize: 16,
    color: COLORS.textGray,
  },
  localVideoContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 120,
    height: 160,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  localVideo: {
    width: '100%',
    height: '100%',
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingBottom: 40,
    paddingHorizontal: 20,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  controlButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  controlButtonActive: {
    backgroundColor: COLORS.error,
  },
  endCallButton: {
    backgroundColor: COLORS.error,
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  answerButton: {
    backgroundColor: COLORS.success,
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  declineButton: {
    backgroundColor: COLORS.error,
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  controlIcon: {
    fontSize: 28,
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 50,
    paddingBottom: 20,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
  },
  callTypeText: {
    fontSize: 18,
    color: '#FFFFFF',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  durationText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  errorText: {
    fontSize: 12,
    color: COLORS.error,
    marginTop: 4,
  },
});

export default CallScreen;
