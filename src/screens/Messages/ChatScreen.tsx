import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useWebRTC } from '../../context/WebRTCContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const ChatScreen = ({ route, navigation }: any) => {
  const { conversationId, otherUser } = route.params;
  const { user } = useUser();
  const { socket } = useSocket();
  const { callUser, isCalling, callAccepted, callEnded } = useWebRTC();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<FlatList>(null);
  const isCallInProgressRef = useRef(false); // Prevent duplicate calls

  useEffect(() => {
    fetchMessages();
    
    if (socket) {
      socket.on('newMessage', handleNewMessage);
      return () => {
        socket.off('newMessage', handleNewMessage);
      };
    }
  }, [socket, conversationId]);
  
  // Reset call in progress flag when call ends or is canceled
  useEffect(() => {
    // If call ended or canceled, reset immediately
    if (callEnded) {
      isCallInProgressRef.current = false;
      return;
    }
    
    // If not calling anymore and call not accepted, reset after short delay
    if (!isCalling && !callAccepted) {
      const timer = setTimeout(() => {
        isCallInProgressRef.current = false;
      }, 200); // Reduced from 500ms to 200ms for faster recovery
      return () => clearTimeout(timer);
    }
  }, [isCalling, callAccepted, callEnded]);

  const fetchMessages = async () => {
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_MESSAGES}/${conversationId}`);
      setMessages(data || []);
      await apiService.put(`${ENDPOINTS.MARK_MESSAGES_SEEN}/${conversationId}`);
    } catch (error) {
      console.error('Error fetching messages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleNewMessage = (data: any) => {
    if (data.conversationId === conversationId) {
      setMessages((prev) => [...prev, data]);
      messagesEndRef.current?.scrollToEnd({ animated: true });
    }
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !socket) return;

    setSending(true);
    try {
      socket.emit('sendMessage', {
        conversationId,
        sender: user?._id,
        text: newMessage.trim(),
      });
      setNewMessage('');
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSending(false);
    }
  };

  const handleCallPress = async (type: 'voice' | 'video') => {
    // CRITICAL: Prevent duplicate calls if already calling or a call is in progress
    if (isCallInProgressRef.current || isCalling || callAccepted) {
      console.warn('⚠️ [ChatScreen] Call already in progress - ignoring duplicate call request', {
        isCallInProgress: isCallInProgressRef.current,
        isCalling,
        callAccepted,
      });
      return;
    }
    
    // Mark that we're initiating a call
    isCallInProgressRef.current = true;
    
    try {
      const callType = type === 'voice' ? 'audio' : 'video';
      const userName = otherUser.name || otherUser.username;
      
      console.log('═══════════════════════════════════════════════════════');
      console.log(`📞 [ChatScreen] ========== INITIATING CALL ==========`);
      console.log(`📞 [ChatScreen] Type: ${callType}`);
      console.log(`📞 [ChatScreen] Target user: ${userName} (${otherUser._id})`);
      console.log(`📞 [ChatScreen] Current user: ${user?._id}`);
      
      // Navigate to CallScreen first, then initiate call
      // This ensures CallScreen is ready to show the calling state
      console.log(`📞 [ChatScreen] Navigating to CallScreen...`);
      navigation.navigate('CallScreen', { 
        userName: userName,
        userId: otherUser._id,
        callType: callType,
        isOutgoingCall: true, // Flag to indicate we're making the call
      });
      console.log(`✅ [ChatScreen] Navigated to CallScreen`);
      
      // Small delay to let CallScreen mount, then initiate call
      console.log(`📞 [ChatScreen] Waiting 300ms before initiating call...`);
      setTimeout(async () => {
        try {
          console.log(`📞 [ChatScreen] Calling callUser function...`);
          await callUser(
            otherUser._id,
            userName,
            callType
          );
          console.log('✅ [ChatScreen] Call initiated successfully');
          console.log('═══════════════════════════════════════════════════════');
        } catch (error: any) {
          console.error('❌ [ChatScreen] ========== CALL INITIATION ERROR ==========');
          console.error('❌ [ChatScreen] Call initiation error:', error);
          console.error('❌ [ChatScreen] Error message:', error?.message);
          console.error('❌ [ChatScreen] Error stack:', error?.stack);
          console.error('═══════════════════════════════════════════════════════');
          // Reset flag on error so user can retry
          isCallInProgressRef.current = false;
        }
      }, 300);
    } catch (error: any) {
      console.error('❌ [ChatScreen] ========== HANDLE CALL PRESS ERROR ==========');
      console.error('❌ [ChatScreen] Call failed:', error);
      // Reset flag on error so user can retry
      isCallInProgressRef.current = false;
      console.error('❌ [ChatScreen] Error message:', error?.message);
      console.error('❌ [ChatScreen] Error stack:', error?.stack);
      console.error('═══════════════════════════════════════════════════════');
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const renderMessage = ({ item }: { item: any }) => {
    const isOwn = item.sender === user?._id;
    return (
      <View style={[styles.messageContainer, isOwn && styles.ownMessage]}>
        <Text style={[styles.messageText, isOwn && styles.ownMessageText]}>
          {item.text}
        </Text>
        <Text style={[styles.messageTime, isOwn && styles.ownMessageTime]}>
          {formatTime(item.createdAt)}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backButton}>←</Text>
        </TouchableOpacity>

        {otherUser?.profilePic ? (
          <Image source={{ uri: otherUser.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>
              {otherUser?.name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
        )}

        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>
            {otherUser?.name || 'User'}
          </Text>
        </View>

        {/* Call Buttons */}
        <TouchableOpacity onPress={() => handleCallPress('voice')} style={styles.callButton}>
          <Text style={styles.callIcon}>📞</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleCallPress('video')} style={styles.callButton}>
          <Text style={styles.callIcon}>📹</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={messagesEndRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item, index) => item._id || index.toString()}
        contentContainerStyle={styles.messagesList}
        onContentSizeChange={() => messagesEndRef.current?.scrollToEnd({ animated: true })}
      />

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Type a message..."
          placeholderTextColor={COLORS.textGray}
          value={newMessage}
          onChangeText={setNewMessage}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendButton, sending && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={sending || !newMessage.trim()}
        >
          {sending ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    fontSize: 24,
    color: COLORS.text,
    marginRight: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  callButton: {
    marginLeft: 15,
  },
  callIcon: {
    fontSize: 24,
  },
  messagesList: {
    padding: 15,
  },
  messageContainer: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: COLORS.backgroundLight,
  },
  ownMessage: {
    alignSelf: 'flex-end',
    backgroundColor: COLORS.primary,
  },
  messageText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 4,
  },
  ownMessageText: {
    color: '#FFFFFF',
  },
  messageTime: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  ownMessageTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginRight: 10,
    color: COLORS.text,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    justifyContent: 'center',
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});

export default ChatScreen;
