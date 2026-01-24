import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
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
  Keyboard,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useWebRTC } from '../../context/WebRTCContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import WebView from 'react-native-webview';
import { useLanguage } from '../../context/LanguageContext';

const ChatScreen = ({ route, navigation }: any) => {
  const { conversationId, userId, otherUser } = route.params || {};
  
  console.log('💬 [ChatScreen] Component render', { 
    conversationId, 
    userId, 
    otherUser: otherUser?._id,
    hasParams: !!route.params 
  });
  const { user } = useUser();
  const { socket, onlineUsers, setSelectedConversationId } = useSocket();
  const { callUser, isCalling, callAccepted, callEnded } = useWebRTC();
  const { colors } = useTheme();
  const { t } = useLanguage();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false); // Start false to avoid flash
  const [sending, setSending] = useState(false);
  const [currentConversationId, setCurrentConversationId] = useState(conversationId);
  const [pendingMedia, setPendingMedia] = useState<any | null>(null); // ImagePicker asset
  const [reactionTargetId, setReactionTargetId] = useState<string | null>(null);
  const [actionTarget, setActionTarget] = useState<any | null>(null);
  const [replyingTo, setReplyingTo] = useState<any | null>(null);
  const messagesEndRef = useRef<FlatList>(null);
  const isCallInProgressRef = useRef(false); // Prevent duplicate calls
  const shouldAutoScrollRef = useRef(true);
  const isSendingRef = useRef(false);
  const hasMarkedSeenRef = useRef(false); // Prevent duplicate markmessageasSeen emits

  const currentUserIdStr = useMemo(() => (user?._id?.toString?.() ?? String(user?._id ?? '')), [user?._id]);
  
  // Track current conversation ID with ref (like web version)
  const currentConversationIdRef = useRef<string | null>(null);

  const getSenderId = (sender: any) => {
    return sender?._id?.toString?.() ?? sender?.toString?.() ?? (sender ? String(sender) : '');
  };

  const isVideoUrl = (url: string) => {
    if (!url) return false;
    return url.includes('/video/upload/') || /\.(mp4|webm|ogg|mov)$/i.test(url);
  };

  // Handle new messages from socket - STABLE FUNCTION (like web version)
  // Defined here (before useEffects) to avoid hoisting issues
  const handleNewMessage = useCallback((data: any) => {
    console.log('🔔🔔🔔 [ChatScreen] handleNewMessage: Received newMessage event!', {
      hasData: !!data,
      conversationId: data?.conversationId,
      currentConversationId: currentConversationIdRef.current,
      senderId: data?.sender?._id || data?.sender,
      currentUserId: user?._id,
      messageId: data?._id,
      messageText: data?.text?.substring(0, 30)
    });

    // Ignore own messages (same as web version) - handleMessageSent already handles them
    const messageSenderId = data.sender?._id?.toString() || data.sender?.toString() || data.sender;
    const currentUserId = user?._id?.toString();
    const isFromCurrentUser = messageSenderId && currentUserId && messageSenderId === currentUserId;
    
    if (isFromCurrentUser) {
      console.log('💬 [ChatScreen] handleNewMessage: Ignoring own message (already handled by handleSend)');
      return;
    }

    // Handle messages for current conversation - Use REF (like web version)
    const currentConvId = currentConversationIdRef.current;
    if (data.conversationId === currentConvId || 
        (data.conversationId && !currentConvId && data.sender === userId)) {
      // If this is the first message and we didn't have a conversationId, set it now
      if (!currentConvId && data.conversationId) {
        console.log('💬 [ChatScreen] handleNewMessage: Setting conversationId', data.conversationId);
        setCurrentConversationId(data.conversationId);
      }
      
      // Prevent duplicate messages
      setMessages((prev) => {
        const isDuplicate = prev.some(msg => 
          msg._id && data._id && msg._id.toString() === data._id.toString()
        );
        if (isDuplicate) {
          console.log('💬 [ChatScreen] handleNewMessage: Duplicate message detected, skipping');
          return prev;
        }
        console.log('💬 [ChatScreen] handleNewMessage: Adding message to list');
        return [...prev, data];
      });
      
      messagesEndRef.current?.scrollToEnd({ animated: true });
    } else {
      console.log('💬 [ChatScreen] handleNewMessage: Message not for current conversation, ignoring');
    }
  }, [user?._id, userId]);

  // Update current conversation ID ref whenever it changes
  useEffect(() => {
    currentConversationIdRef.current = currentConversationId || conversationId || null;
  }, [currentConversationId, conversationId]);

  // Set up socket listener ONCE (like web version) - persistent listener
  useEffect(() => {
    if (!socket || !user?._id) return;
    
    console.log('✅ [ChatScreen] Setting up newMessage socket listener (persistent)');
    
    socket.on('newMessage', handleNewMessage);
    
    return () => {
      console.log('🔌 [ChatScreen] Removing newMessage socket listener');
      socket.off('newMessage', handleNewMessage);
    };
  }, [socket, user?._id, handleNewMessage]);

  useEffect(() => {
    console.log('💬 [ChatScreen] useEffect: Mount/Update', { 
      conversationId, 
      userId, 
      otherUser: otherUser?._id,
      hasOtherUser: !!otherUser,
      socket: !!socket,
      user: !!user?._id
    });
    
    // Reset mark seen flag when conversation changes
    hasMarkedSeenRef.current = false;
    
    // If we have userId but no conversationId, we're starting a new conversation
    // The conversation will be created when we send the first message
    if (conversationId) {
      console.log('💬 [ChatScreen] useEffect: Has conversationId, setting and fetching');
      setCurrentConversationId(conversationId);
      // Call fetchMessages after a tiny delay to ensure state is set
      setTimeout(() => {
        fetchMessages();
      }, 50);
    } else if (userId && otherUser) {
      // New conversation - no messages to fetch yet
      console.log('💬 [ChatScreen] useEffect: New conversation (userId + otherUser), stopping loading');
      setLoading(false);
    } else if (otherUser?._id) {
      // We have otherUser but no conversationId - try to fetch messages anyway
      console.log('💬 [ChatScreen] useEffect: Has otherUser but no conversationId, fetching messages');
      setTimeout(() => {
        fetchMessages();
      }, 50);
    } else {
      console.log('💬 [ChatScreen] useEffect: No conversationId or userId+otherUser, stopping loading');
      setLoading(false);
    }
  }, [conversationId, userId, otherUser?._id, user?._id]);

  // Track currently open conversation globally (used to avoid incrementing unread while viewing)
  useEffect(() => {
    const id = (currentConversationId || conversationId || null)?.toString?.() ?? (currentConversationId || conversationId || null);
    setSelectedConversationId(id);
    return () => setSelectedConversationId(null);
  }, [setSelectedConversationId, currentConversationId, conversationId]);
  
  // Reset call in progress flag when call ends or is canceled
  useEffect(() => {
    // OPTIMIZATION: Reset immediately when call ends for smooth re-calling
    // This ensures users can call again immediately after cancel/decline (critical for 1M+ users)
    if (callEnded) {
      isCallInProgressRef.current = false;
      console.log('✅ [ChatScreen] Call ended - isCallInProgressRef reset immediately');
      return;
    }
    
    // If not calling anymore and call not accepted, reset immediately (no delay)
    // This allows immediate re-calling after cancel/decline
    if (!isCalling && !callAccepted) {
      isCallInProgressRef.current = false;
      console.log('✅ [ChatScreen] Not calling - isCallInProgressRef reset immediately');
    }
  }, [isCalling, callAccepted, callEnded]);

  const fetchMessages = useCallback(async () => {
    // Backend expects otherUserId, not conversationId (same as web version)
    // Try to get otherUserId from multiple sources
    const otherUserId = otherUser?._id || userId || (route.params?.otherUser?._id) || (route.params?.userId);
    
    console.log('💬 [ChatScreen] fetchMessages: Called', { 
      otherUserId, 
      conversationId, 
      currentConversationId,
      otherUser: otherUser?._id,
      userId,
      routeParams: route.params
    });
    
    if (!otherUserId) {
      console.error('❌ [ChatScreen] fetchMessages: No otherUserId found!', {
        otherUser,
        userId,
        routeParams: route.params
      });
      setLoading(false);
      return;
    }
    
    setLoading(true);
    console.log('💬 [ChatScreen] fetchMessages: Starting API call', { otherUserId });
    
    try {
      const url = `${ENDPOINTS.GET_MESSAGES}/${otherUserId}`;
      console.log('💬 [ChatScreen] fetchMessages: Calling', url);
      const response = await apiService.get(url);
      console.log('💬 [ChatScreen] fetchMessages: API response received', { 
        response,
        messagesCount: response.messages?.length, 
        hasMore: response.hasMore,
        isArray: Array.isArray(response)
      });
      
      // Backend returns { messages: [], hasMore: false } (same as web version)
      const messagesData = response.messages || (Array.isArray(response) ? response : []);
      console.log('💬 [ChatScreen] fetchMessages: Setting messages', { count: messagesData.length });
      setMessages(messagesData);
      
      // Mark messages as seen via socket (ONCE per conversation open, prevent infinite loop)
      const convId = currentConversationId || conversationId;
      if (socket && convId && otherUser?._id && user?._id && !hasMarkedSeenRef.current) {
        console.log('💬 [ChatScreen] fetchMessages: Marking messages as seen', { 
          conversationId: convId, 
          userId: otherUser._id 
        });
        hasMarkedSeenRef.current = true;
        socket.emit('markmessageasSeen', {
          conversationId: convId,
          userId: otherUser._id
        });
      }
      
      // Auto-scroll to bottom after messages load
      setTimeout(() => {
        if (shouldAutoScrollRef.current) {
          messagesEndRef.current?.scrollToEnd({ animated: false });
        }
      }, 100);
    } catch (error: any) {
      console.error('❌ [ChatScreen] fetchMessages: Error', error);
      console.error('❌ [ChatScreen] fetchMessages: Error message', error?.message);
      console.error('❌ [ChatScreen] fetchMessages: Error stack', error?.stack);
      setMessages([]);
    } finally {
      console.log('💬 [ChatScreen] fetchMessages: Setting loading to false');
      setLoading(false);
    }
  }, [otherUser?._id, userId, conversationId, currentConversationId, socket, user?._id]);

  const handleSend = async () => {
    if (!newMessage.trim() && !pendingMedia) return;

    const recipientId = otherUser?._id || userId;
    if (!recipientId) return;

    setSending(true);
    isSendingRef.current = true;
    shouldAutoScrollRef.current = true;
    try {
      let response: any = null;

      // If media selected, send multipart (backend supports upload.single('file'))
      if (pendingMedia) {
        const formData = new FormData();
        formData.append('recipientId', recipientId);
        formData.append('message', newMessage.trim());
        if (replyingTo?._id) {
          formData.append('replyTo', replyingTo._id);
        }

        const uri = pendingMedia.uri;
        const name = pendingMedia.fileName || `upload_${Date.now()}`;
        const type = pendingMedia.type || 'application/octet-stream';

        // @ts-ignore - RN FormData file shape
        formData.append('file', { uri, name, type });

        response = await apiService.upload(ENDPOINTS.SEND_MESSAGE, formData);
      } else {
        // Text-only message
        response = await apiService.post(ENDPOINTS.SEND_MESSAGE, {
          recipientId: recipientId,
          message: newMessage.trim(),
          replyTo: replyingTo?._id || null,
        });
      }

      // Handle successful send (same as web version's handleMessageSent)
      if (response) {
        const messageWithSender = {
          ...response,
          sender: response.sender || {
            _id: user?._id,
            name: user?.name,
            username: user?.username,
            profilePic: user?.profilePic
          }
        };
        
        // Add message to local state immediately
        setMessages((prev) => {
          const updated = [...prev, messageWithSender];
          // Limit to 200 messages max (same as web version)
          if (updated.length > 200) {
            return updated.slice(-200);
          }
          return updated;
        });
        
        // Update conversationId if this was a new conversation
        if (!currentConversationId && response.conversationId) {
          setCurrentConversationId(response.conversationId);
        }
        
        setNewMessage('');
        setPendingMedia(null);
        setReplyingTo(null);
        // Scroll after layout settles (esp. for images/videos)
        setTimeout(() => messagesEndRef.current?.scrollToEnd({ animated: true }), 120);
      }
    } catch (error) {
      console.error('❌ [ChatScreen] handleSend: Error', error);
    } finally {
      setSending(false);
      isSendingRef.current = false;
    }
  };

  const handlePickMedia = async () => {
    try {
      const res = await launchImageLibrary({
        mediaType: 'mixed',
        selectionLimit: 1,
        quality: 0.8,
        includeBase64: false,
      });
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setPendingMedia(asset);
      }
    } catch (e) {
      console.error('❌ [ChatScreen] handlePickMedia error:', e);
    }
  };

  const handleToggleReaction = async (messageId: string, emoji: string) => {
    try {
      const updated = await apiService.post(`${ENDPOINTS.SEND_MESSAGE}/reaction/${messageId}`, { emoji });
      // Backend returns updated message with populated reactions.userId
      setMessages((prev) => prev.map((m) => (m._id?.toString?.() === messageId.toString() ? { ...m, ...updated } : m)));
    } catch (e) {
      console.error('❌ [ChatScreen] toggleReaction error:', e);
    } finally {
      setReactionTargetId(null);
      setActionTarget(null);
    }
  };

  const handleDeleteMessage = async (messageId: string) => {
    try {
      await apiService.delete(`${ENDPOINTS.SEND_MESSAGE}/message/${messageId}`);
      setMessages((prev) => prev.filter((m) => (m._id?.toString?.() ?? String(m._id)) !== messageId.toString()));
    } catch (e) {
      console.error('❌ [ChatScreen] deleteMessage error:', e);
    } finally {
      setReactionTargetId(null);
      setActionTarget(null);
    }
  };

  const handleCallPress = async (type: 'voice' | 'video') => {
    // CRITICAL: Prevent duplicate calls if already calling or a call is in progress
    // Allow new calls if callEnded is true (previous call finished) OR if callAccepted is false (no active call)
    // Only block if: actively calling OR (call accepted AND call not ended)
    const isCallActive = isCallInProgressRef.current || isCalling || (callAccepted && !callEnded);
    
    if (isCallActive) {
      console.warn('⚠️ [ChatScreen] Call already in progress - ignoring duplicate call request', {
        isCallInProgress: isCallInProgressRef.current,
        isCalling,
        callAccepted,
        callEnded,
      });
      return;
    }
    
    // CRITICAL: If callEnded is true OR callAccepted is false, allow new calls
    // The check above already handles this, but we log for debugging
    if (callEnded) {
      console.log('✅ [ChatScreen] Previous call ended - allowing new call', {
        callEnded,
        callAccepted,
        isCalling,
      });
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

  // Check if the other user is online
  const isOtherUserOnline = () => {
    if (!otherUser?._id || !onlineUsers || !Array.isArray(onlineUsers)) return false;
    
    const otherUserIdStr = otherUser._id?.toString();
    return onlineUsers.some((online: any) => {
      let onlineUserId = null;
      if (typeof online === 'object' && online !== null) {
        onlineUserId = online.userId?.toString() || online._id?.toString() || online.toString();
      } else {
        onlineUserId = online?.toString();
      }
      return onlineUserId === otherUserIdStr;
    });
  };

  const renderMessage = ({ item }: { item: any }) => {
    const senderId = getSenderId(item.sender);
    const isOwn = senderId === currentUserIdStr;
    // Per your request: sender on LEFT, receiver on RIGHT
    const isSenderLeft = isOwn;
    
    // Get profile picture: for own messages use user.profilePic, for others use sender.profilePic or otherUser.profilePic
    const senderProfilePic = isOwn 
      ? user?.profilePic 
      : (item.sender?.profilePic || otherUser?.profilePic);
    const senderName = isOwn 
      ? (user?.name || user?.username) 
      : (item.sender?.name || item.sender?.username || otherUser?.name || otherUser?.username);
    
    return (
      <View style={[styles.messageRow, isSenderLeft ? styles.leftRow : styles.rightRow]}>
        {/* Profile picture - on left for sender, on right for receiver */}
        {isSenderLeft ? (
          <View style={styles.messageAvatarContainer}>
            {senderProfilePic ? (
              <Image source={{ uri: senderProfilePic }} style={styles.messageAvatar} />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                <Text style={styles.messageAvatarText}>
                  {senderName?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>
        ) : null}
        
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={() => {
            // If reaction picker is already showing for this message, dismiss it
            const currentMessageId = item._id?.toString?.() ?? null;
            if (reactionTargetId === currentMessageId) {
              setReactionTargetId(null);
              setActionTarget(null);
            }
          }}
          onLongPress={() => {
            setReactionTargetId(item._id?.toString?.() ?? null);
            setActionTarget(item);
          }}
          style={[
            styles.messageContainer, 
            isSenderLeft ? styles.senderMessage : styles.receiverMessage,
            isSenderLeft ? { backgroundColor: colors.primary } : { backgroundColor: colors.backgroundLight }
          ]}
        >
          {item.replyTo && (
            <View style={[styles.replyPreviewInBubble, { backgroundColor: colors.border }]}>
              <Text style={[styles.replyPreviewLabel, { color: isSenderLeft ? colors.buttonText : colors.text }]}>
                Reply to {item.replyTo?.sender?.name || item.replyTo?.sender?.username || 'message'}
              </Text>
              <Text numberOfLines={2} style={[styles.replyPreviewText, { color: isSenderLeft ? colors.buttonText : colors.textGray }]}>
                {item.replyTo?.text || (item.replyTo?.img ? '📎 Attachment' : '')}
              </Text>
            </View>
          )}

          {!!item.text && (
            <Text style={[
              styles.messageText, 
              isSenderLeft ? styles.senderText : styles.receiverText,
              isSenderLeft ? { color: colors.buttonText } : { color: colors.text }
            ]}>
              {item.text}
            </Text>
          )}

          {!!item.img && !isVideoUrl(item.img) && (
            <Image
              source={{ uri: item.img }}
              style={styles.chatImage}
              resizeMode="cover"
              onLoadEnd={() => {
                // When an image finishes loading, the content height changes; scroll again.
                if (shouldAutoScrollRef.current) {
                  setTimeout(() => messagesEndRef.current?.scrollToEnd({ animated: true }), 80);
                }
              }}
            />
          )}

          {!!item.img && isVideoUrl(item.img) && (
            <View style={styles.chatVideoContainer}>
              <WebView
                source={{
                  html: `<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" /></head><body style=\"margin:0;background:black;\"><video controls playsinline style=\"width:100%;height:100%;\" src=\"${item.img}\"></video></body></html>`,
                }}
                style={styles.chatVideo}
                allowsFullscreenVideo
                mediaPlaybackRequiresUserAction
              />
            </View>
          )}

          <Text style={[
            styles.messageTime, 
            isSenderLeft ? styles.senderTime : styles.receiverTime,
            isSenderLeft ? { color: colors.buttonText } : { color: colors.textGray }
          ]}>
            {formatTime(item.createdAt)}
          </Text>

          {/* Reactions (simple display) */}
          {Array.isArray(item.reactions) && item.reactions.length > 0 && (
            <View style={styles.reactionsRow}>
              {item.reactions.slice(0, 6).map((r: any, idx: number) => (
                <Text key={`${item._id}-r-${idx}`} style={styles.reactionEmoji}>{r.emoji}</Text>
              ))}
            </View>
          )}
        </TouchableOpacity>
        
        {/* Profile picture - on right for receiver */}
        {!isSenderLeft ? (
          <View style={styles.messageAvatarContainer}>
            {senderProfilePic ? (
              <Image source={{ uri: senderProfilePic }} style={styles.messageAvatar} />
            ) : (
              <View style={[styles.messageAvatar, styles.messageAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                <Text style={styles.messageAvatarText}>
                  {senderName?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
            )}
          </View>
        ) : null}
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

  const Wrapper: any = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const wrapperProps =
    Platform.OS === 'ios'
      ? { behavior: 'padding' as const, keyboardVerticalOffset: 90 }
      : {};

  return (
    <Wrapper style={[styles.container, { backgroundColor: colors.background }]} {...wrapperProps}>
      <View style={[styles.header, { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backButton, { color: colors.text }]}>←</Text>
        </TouchableOpacity>

        {otherUser?.profilePic ? (
          <Image source={{ uri: otherUser.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
            <Text style={styles.avatarText}>
              {otherUser?.name?.[0]?.toUpperCase() || '?'}
            </Text>
          </View>
        )}

        <View style={styles.headerInfo}>
          <View style={styles.headerTitleRow}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {otherUser?.name || 'User'}
            </Text>
            {isOtherUserOnline() && (
              <View style={[styles.headerOnlineDot, { backgroundColor: colors.success }]} />
            )}
          </View>
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
        onScrollBeginDrag={() => {
          // User is browsing older messages; don't force-scroll
          shouldAutoScrollRef.current = false;
        }}
        onContentSizeChange={() => {
          // Only auto-scroll if we just sent/received OR user is already at bottom
          if (shouldAutoScrollRef.current || isSendingRef.current) {
            setTimeout(() => messagesEndRef.current?.scrollToEnd({ animated: true }), 60);
          }
        }}
      />

      {/* Reaction picker (minimal) */}
      {reactionTargetId && actionTarget && (
        <View style={[styles.reactionPicker, { backgroundColor: colors.backgroundLight, borderTopColor: colors.border }]}>
          <TouchableOpacity
            onPress={() => {
              setReplyingTo(actionTarget);
              setReactionTargetId(null);
              setActionTarget(null);
            }}
            style={[styles.actionBtn, { backgroundColor: colors.primary }]}
          >
            <Text style={styles.actionBtnText}>{t('reply')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => handleDeleteMessage(actionTarget._id)}
            style={[styles.actionBtn, { backgroundColor: colors.error }]}
          >
            <Text style={[styles.actionBtnText, { color: '#FFFFFF' }]}>{t('delete')}</Text>
          </TouchableOpacity>

          <View style={[styles.actionDivider, { backgroundColor: colors.border }]} />

          {['👍', '❤️', '😂', '😮', '😢', '🔥', '👏', '✅', '😡', '🎉', '🤝', '🙏'].map((e) => (
            <TouchableOpacity key={e} onPress={() => handleToggleReaction(reactionTargetId, e)} style={styles.reactionPickBtn}>
              <Text style={styles.reactionPickEmoji}>{e}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity onPress={() => { setReactionTargetId(null); setActionTarget(null); }} style={styles.reactionPickBtn}>
            <Text style={styles.reactionPickEmoji}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {replyingTo && (
        <View style={[styles.replyBanner, { backgroundColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.replyBannerTitle, { color: colors.text }]}>
              {t('replyingTo')} {replyingTo?.sender?.name || replyingTo?.sender?.username || t('message')}
            </Text>
            <Text numberOfLines={1} style={[styles.replyBannerText, { color: colors.textGray }]}>
              {replyingTo?.text || (replyingTo?.img ? t('attachment') : '')}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setReplyingTo(null)}>
            <Text style={[styles.replyBannerClose, { color: colors.text }]}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Media preview */}
      {pendingMedia?.uri ? (
        <View style={[styles.mediaPreview, { backgroundColor: colors.border }]}>
          <Text style={[styles.mediaPreviewText, { color: colors.text }]}>
            {pendingMedia.type?.startsWith('video') ? t('videoSelected') : t('imageSelected')}
          </Text>
          <TouchableOpacity onPress={() => setPendingMedia(null)}>
            <Text style={[styles.mediaRemove, { color: colors.error }]}>{t('remove')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <View style={[styles.inputContainer, { backgroundColor: colors.backgroundLight, borderTopColor: colors.border }]}>
        <TouchableOpacity onPress={handlePickMedia} style={[styles.attachBtn, { backgroundColor: colors.border }]}>
          <Text style={[styles.attachIcon, { color: colors.text }]}>＋</Text>
        </TouchableOpacity>
        <TextInput
          style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
          placeholder={t('typeMessage')}
          placeholderTextColor={colors.textGray}
          value={newMessage}
          onChangeText={setNewMessage}
          multiline
          onFocus={() => {
            // When keyboard opens, ensure input and latest message are visible
            shouldAutoScrollRef.current = true;
            setTimeout(() => messagesEndRef.current?.scrollToEnd({ animated: true }), 120);
          }}
        />
        <TouchableOpacity
          style={[styles.sendButton, { backgroundColor: colors.primary }, sending && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={sending || (!newMessage.trim() && !pendingMedia)}
        >
          {sending ? (
            <ActivityIndicator color={colors.buttonText} />
          ) : (
            <Text style={[styles.sendButtonText, { color: colors.buttonText }]}>{t('send')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </Wrapper>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
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
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  headerOnlineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.success,
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
  messageRow: {
    width: '100%',
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  leftRow: {
    justifyContent: 'flex-start',
  },
  rightRow: {
    justifyContent: 'flex-end',
  },
  messageAvatarContainer: {
    marginHorizontal: 8,
    marginBottom: 4,
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  messageAvatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  messageAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  messageContainer: {
    maxWidth: '75%',
    padding: 12,
    borderRadius: 12,
    backgroundColor: COLORS.backgroundLight,
  },
  senderMessage: {
    backgroundColor: COLORS.backgroundLight,
  },
  receiverMessage: {
    backgroundColor: COLORS.primary,
  },
  messageText: {
    fontSize: 16,
    color: COLORS.text,
    marginBottom: 4,
  },
  senderText: {
    color: COLORS.text,
  },
  receiverText: {
    color: '#FFFFFF',
  },
  messageTime: {
    fontSize: 12,
    color: COLORS.textGray,
  },
  senderTime: {
    color: COLORS.textGray,
  },
  receiverTime: {
    color: 'rgba(255, 255, 255, 0.7)',
  },
  chatImage: {
    width: 220,
    height: 220,
    borderRadius: 12,
    marginTop: 8,
  },
  chatVideoContainer: {
    width: 260,
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    marginTop: 8,
    backgroundColor: '#000',
  },
  chatVideo: {
    flex: 1,
    backgroundColor: '#000',
  },
  reactionsRow: {
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  actionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.backgroundLight,
    marginRight: 8,
  },
  actionBtnText: {
    fontSize: 13,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  actionDivider: {
    width: 1,
    height: 24,
    backgroundColor: COLORS.border,
    marginHorizontal: 8,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  replyBannerTitle: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: 'bold',
  },
  replyBannerText: {
    fontSize: 12,
    color: COLORS.textGray,
    marginTop: 2,
  },
  replyBannerClose: {
    fontSize: 16,
    color: COLORS.textGray,
    marginLeft: 12,
    padding: 6,
  },
  replyPreviewInBubble: {
    borderLeftWidth: 3,
    borderLeftColor: 'rgba(255,255,255,0.4)',
    paddingLeft: 8,
    marginBottom: 6,
    opacity: 0.95,
  },
  replyPreviewLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: 'bold',
  },
  replyPreviewText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    marginTop: 2,
  },
  reactionPickBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  reactionPickEmoji: {
    fontSize: 18,
  },
  mediaPreview: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  mediaPreviewText: {
    color: COLORS.textGray,
    fontSize: 13,
  },
  mediaRemove: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: 'bold',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
    alignItems: 'flex-end',
  },
  attachBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
    backgroundColor: COLORS.backgroundLight,
  },
  attachIcon: {
    fontSize: 22,
    color: COLORS.text,
    lineHeight: 22,
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
