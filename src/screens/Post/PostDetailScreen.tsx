import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  FlatList,
  Image,
  Keyboard,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import ThreadedComment from '../../components/ThreadedComment';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useLanguage } from '../../context/LanguageContext';

const PostDetailScreen = ({ route, navigation }: any) => {
  const { postId, fromScreen, userProfileParams } = route.params || {};
  const { user } = useUser();
  const showToast = useShowToast();
  const { t } = useLanguage();
  
  // Customize back button behavior based on where we came from
  React.useEffect(() => {
    if (fromScreen === 'UserProfile') {
      navigation.setOptions({
        headerLeft: () => (
          <TouchableOpacity
            onPress={() => {
              // Navigate back to UserProfile with the same params
              if (userProfileParams) {
                navigation.navigate('UserProfile', userProfileParams);
              } else {
                navigation.goBack();
              }
            }}
            style={{ marginLeft: 10 }}
          >
            <Text style={{ color: COLORS.text, fontSize: 24 }}>←</Text>
          </TouchableOpacity>
        ),
      });
    } else {
      // Default back button - will go back to previous screen (FeedScreen or UserProfile)
      navigation.setOptions({
        headerLeft: undefined,
      });
    }
  }, [fromScreen, navigation, userProfileParams]);

  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyParentId, setReplyParentId] = useState<string | null>(null); // null = top-level comment
  
  // Pagination for comments
  const COMMENTS_PER_PAGE = 20;
  const [visibleCommentsCount, setVisibleCommentsCount] = useState(COMMENTS_PER_PAGE);
  
  // Mention autocomplete state
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const replyInputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    fetchPost();
  }, [postId]);

  const fetchPost = async () => {
    try {
      console.log('📥 [PostDetail] Fetching post:', postId);
      const data = await apiService.get(`${ENDPOINTS.GET_POST}/${postId}`);
      console.log('✅ [PostDetail] Post fetched:', data?._id);
      setPost(data);
      // Reset visible comments count when fetching a new post
      setVisibleCommentsCount(COMMENTS_PER_PAGE);
    } catch (error: any) {
      console.error('❌ [PostDetail] Error fetching post:', error);
      console.error('❌ [PostDetail] Post ID:', postId);
      showToast('Error', 'Failed to load post', 'error');
      // Don't auto-navigate back, let user see the error
      // navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // List of channel usernames to exclude from mention search
  const channelUsernames = [
    'Football',
    'Weather',
    'AlJazeera',
    'NBCNews',
    'BeinSportsNews',
    'SkyNews',
    'Cartoonito',
    'NatGeoKids',
    'SciShowKids',
    'JJAnimalTime',
    'KidsArabic',
    'NatGeoAnimals',
    'MBCDrama',
    'Fox11',
  ];

  // Search users for mention autocomplete (exclude channels)
  const searchMentionUsers = async (searchTerm: string) => {
    if (!searchTerm || searchTerm.length < 1) {
      setMentionSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const users = await apiService.get(`${ENDPOINTS.SEARCH_USERS}?search=${encodeURIComponent(searchTerm)}`);
      // Filter out channels - only return regular users
      const filteredUsers = Array.isArray(users)
        ? users.filter((user: any) => !channelUsernames.includes(user.username))
        : [];
      setMentionSuggestions(filteredUsers);
      setShowSuggestions(filteredUsers.length > 0);
      setSelectedSuggestionIndex(0);
    } catch (error) {
      console.error('Error searching users:', error);
      setMentionSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Handle text input change and detect @mentions
  const handleReplyTextChange = (text: string) => {
    setReplyText(text);
    
    // Find the last @ symbol before cursor (we'll use the end of text as cursor position approximation)
    const lastAtIndex = text.lastIndexOf('@');
    
    if (lastAtIndex !== -1) {
      // Get text after @
      const textAfterAt = text.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      const newlineIndex = textAfterAt.indexOf('\n');
      const endIndex = spaceIndex !== -1 || newlineIndex !== -1
        ? Math.min(spaceIndex !== -1 ? spaceIndex : Infinity, newlineIndex !== -1 ? newlineIndex : Infinity)
        : textAfterAt.length;
      
      const mentionTerm = textAfterAt.substring(0, endIndex);
      
      // If there's no space after @, we're typing a mention
      if (endIndex === textAfterAt.length && mentionTerm.length >= 0) {
        setMentionStartIndex(lastAtIndex);
        searchMentionUsers(mentionTerm);
      } else {
        setShowSuggestions(false);
        setMentionSuggestions([]);
      }
    } else {
      setShowSuggestions(false);
      setMentionSuggestions([]);
    }
  };

  // Select a user from mention suggestions
  const selectMentionUser = (selectedUser: any) => {
    if (mentionStartIndex === -1) return;
    
    const textBefore = replyText.substring(0, mentionStartIndex);
    const textAfter = replyText.substring(mentionStartIndex);
    const spaceAfterMention = textAfter.indexOf(' ');
    const textAfterMention = spaceAfterMention !== -1 
      ? textAfter.substring(spaceAfterMention)
      : ' ';
    
    // Replace @mentionTerm with @username
    const newText = `${textBefore}@${selectedUser.username}${textAfterMention}`;
    setReplyText(newText);
    setShowSuggestions(false);
    setMentionSuggestions([]);
    setMentionStartIndex(-1);
    
    // Focus back on input after selection
    setTimeout(() => {
      replyInputRef.current?.focus();
    }, 100);
  };

  const handleReply = async () => {
    if (!replyText.trim()) {
      showToast(t('error'), t('pleaseEnterReply'), 'error');
      return;
    }

    // Dismiss keyboard when sending
    Keyboard.dismiss();

    setReplying(true);
    try {
      const text = replyText.trim();
      const endpoint = replyParentId ? ENDPOINTS.REPLY_TO_COMMENT : ENDPOINTS.REPLY_POST;

      const data = await apiService.put(`${endpoint}/${postId}`, {
        text,
        ...(replyParentId ? { parentReplyId: replyParentId } : {}),
      });

      // Backend returns the new reply object; append it to post.replies like the web does.
      const newReplyId = data?._id?.toString?.() ?? String(data?._id);
      setPost((prev: any) => {
        const prevReplies = Array.isArray(prev?.replies) ? prev.replies : [];
        const replyWithLikes = { ...data, likes: data?.likes || [] };
        return { ...prev, replies: [...prevReplies, replyWithLikes] };
      });
      setReplyText('');
      setReplyParentId(null);
      setShowSuggestions(false);
      setMentionSuggestions([]);
      
      // Scroll to the newly posted comment after a delay to ensure it's rendered
      setTimeout(() => {
        if (scrollViewRef.current) {
          // Scroll to the bottom to show the new comment with extra offset
          scrollViewRef.current.scrollToEnd({ animated: true });
        }
      }, 100);
      
      // Additional scroll after a longer delay to ensure smooth animation
      setTimeout(() => {
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollToEnd({ animated: true });
        }
      }, 500);
    } catch (error: any) {
      showToast(t('error'), error.message || t('failedToPostReply'), 'error');
    } finally {
      setReplying(false);
    }
  };

  const removeReplyAndDescendants = (replies: any[], deletedId: string) => {
    const idStr = deletedId?.toString?.() ?? String(deletedId);
    const toDelete = new Set<string>([idStr]);

    let changed = true;
    while (changed) {
      changed = false;
      for (const r of replies) {
        const rId = r?._id?.toString?.() ?? String(r?._id);
        const parent = r?.parentReplyId?.toString?.() ?? (r?.parentReplyId ? String(r.parentReplyId) : null);
        if (parent && toDelete.has(parent) && !toDelete.has(rId)) {
          toDelete.add(rId);
          changed = true;
        }
      }
    }

    return replies.filter((r) => {
      const rId = r?._id?.toString?.() ?? String(r?._id);
      return !toDelete.has(rId);
    });
  };

  const handleLikeComment = async (reply: any) => {
    if (!user?._id) {
      showToast(t('error'), t('mustBeLoggedInToLike'), 'error');
      return;
    }

    const replyId = reply?._id?.toString?.() ?? String(reply?._id);
    try {
      const data = await apiService.put(`${ENDPOINTS.LIKE_COMMENT}/${postId}/${replyId}`);

      setPost((prev: any) => {
        const prevReplies = Array.isArray(prev?.replies) ? prev.replies : [];
        const updatedReplies = prevReplies.map((r: any) => {
          const rId = r?._id?.toString?.() ?? String(r?._id);
          if (rId !== replyId) return r;

          const likesArr = Array.isArray(r?.likes) ? r.likes : [];
          const userIdStr = user._id?.toString?.() ?? String(user._id);
          const nextLikes = data?.isLiked
            ? [...likesArr, userIdStr]
            : likesArr.filter((id: any) => (id?.toString?.() ?? String(id)) !== userIdStr);

          return { ...r, likes: nextLikes };
        });
        return { ...prev, replies: updatedReplies };
      });
    } catch (error: any) {
      showToast(t('error'), error.message || t('failedToLikeComment'), 'error');
    }
  };

  const handleDeleteComment = async (reply: any) => {
    if (!user?._id) {
      showToast(t('error'), t('mustBeLoggedInToDelete'), 'error');
      return;
    }

    const replyId = reply?._id?.toString?.() ?? String(reply?._id);
    try {
      await apiService.delete(`${ENDPOINTS.DELETE_COMMENT}/${postId}/${replyId}`);
      setPost((prev: any) => {
        const prevReplies = Array.isArray(prev?.replies) ? prev.replies : [];
        return { ...prev, replies: removeReplyAndDescendants(prevReplies, replyId) };
      });
      showToast(t('success'), t('commentDeletedSuccessfully'), 'success');
    } catch (error: any) {
      showToast(t('error'), error.message || t('failedToDeleteComment'), 'error');
    }
  };

  const handleReplyPress = (reply: any) => {
    // Like web: prefill @username and reply to that comment (parentReplyId = reply._id)
    const username = reply?.username || '';
    setReplyParentId(reply?._id?.toString?.() ?? String(reply?._id));
    setReplyText(username ? `@${username} ` : '');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>{t('postNotFound')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        ref={scrollViewRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchPost();
            }}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <Post post={post} disableNavigation={true} />

        <View style={styles.repliesSection}>
          <Text style={styles.repliesTitle}>{t('comments')} ({post.replies?.length || 0})</Text>

          {(post.replies || [])
            .filter((r: any) => !r?.parentReplyId)
            .slice(0, visibleCommentsCount)
            .map((reply: any) => (
              <ThreadedComment
                key={reply?._id?.toString?.() ?? String(reply?._id)}
                reply={reply}
                allReplies={post.replies || []}
                postId={postId}
                postOwnerId={post?.postedBy?._id?.toString?.() ?? String(post?.postedBy)}
                currentUserId={user?._id?.toString?.() ?? String(user?._id)}
                currentUserProfilePic={user?.profilePic}
                onReplyPress={handleReplyPress}
                onLikePress={handleLikeComment}
                onDeletePress={handleDeleteComment}
                onMentionPress={(username: string) => navigation.navigate('UserProfile', { username })}
              />
            ))}
          
          {/* Load More button */}
          {post.replies && 
           (post.replies.filter((r: any) => !r?.parentReplyId).length > visibleCommentsCount) && (
            <TouchableOpacity
              style={styles.loadMoreButton}
              onPress={() => {
                setVisibleCommentsCount(prev => prev + COMMENTS_PER_PAGE);
                // Scroll to show the newly loaded comments after a short delay
                setTimeout(() => {
                  scrollViewRef.current?.scrollToEnd({ animated: true });
                }, 100);
              }}
            >
              <Text style={styles.loadMoreText}>
                {t('loadMoreComments')} ({post.replies.filter((r: any) => !r?.parentReplyId).length - visibleCommentsCount} {t('remaining')})
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <View style={styles.inputContainer}>
        <View style={styles.inputWrapper}>
          <TextInput
            ref={replyInputRef}
            style={styles.input}
            placeholder={replyParentId ? t('writeReplyToComment') : t('writeComment')}
            placeholderTextColor={COLORS.textGray}
            value={replyText}
            onChangeText={handleReplyTextChange}
            multiline
          />
          
          {/* Mention suggestions dropdown */}
          {showSuggestions && mentionSuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              <FlatList
                data={mentionSuggestions}
                keyExtractor={(item) => item._id?.toString() || item.username || String(Math.random())}
                renderItem={({ item, index }) => (
                  <TouchableOpacity
                    style={[
                      styles.suggestionItem,
                      index === selectedSuggestionIndex && styles.suggestionItemSelected,
                    ]}
                    onPress={() => selectMentionUser(item)}
                  >
                    {item.profilePic ? (
                      <Image source={{ uri: item.profilePic }} style={styles.suggestionAvatar} />
                    ) : (
                      <View style={[styles.suggestionAvatar, styles.suggestionAvatarPlaceholder]}>
                        <Text style={styles.suggestionAvatarText}>
                          {(item.username || '?')[0]?.toUpperCase() || '?'}
                        </Text>
                      </View>
                    )}
                    <View style={styles.suggestionInfo}>
                      <Text style={styles.suggestionUsername}>{item.username}</Text>
                      {item.name && <Text style={styles.suggestionName}>{item.name}</Text>}
                    </View>
                  </TouchableOpacity>
                )}
                style={styles.suggestionsList}
                keyboardShouldPersistTaps="handled"
              />
            </View>
          )}
        </View>
        
        <TouchableOpacity
          style={[styles.sendButton, replying && styles.sendButtonDisabled]}
          onPress={handleReply}
          disabled={replying || !replyText.trim()}
        >
          {replying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.sendButtonText}>Send</Text>
          )}
        </TouchableOpacity>
      </View>
      </KeyboardAvoidingView>
    </View>
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
    backgroundColor: COLORS.background,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingBottom: 150, // Extra padding to ensure new comments are fully visible when scrolled
  },
  errorText: {
    fontSize: 16,
    color: COLORS.textGray,
    textAlign: 'center',
    marginTop: 50,
  },
  repliesSection: {
    padding: 15,
  },
  repliesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 15,
  },
  replyItem: {
    padding: 12,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 8,
    marginBottom: 10,
  },
  replyAuthor: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 5,
  },
  replyText: {
    fontSize: 14,
    color: COLORS.text,
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 15,
    paddingBottom: Platform.OS === 'ios' ? 15 : 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  inputWrapper: {
    flex: 1,
    marginRight: 10,
    position: 'relative',
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    color: COLORS.text,
    maxHeight: 100,
  },
  suggestionsContainer: {
    position: 'absolute',
    bottom: '100%',
    left: 0,
    right: 0,
    marginBottom: 8,
    backgroundColor: COLORS.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    maxHeight: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 5,
    zIndex: 1000,
  },
  suggestionsList: {
    maxHeight: 200,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  suggestionItemSelected: {
    backgroundColor: COLORS.backgroundLight,
  },
  suggestionAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: COLORS.backgroundLight,
  },
  suggestionAvatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestionAvatarText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  suggestionInfo: {
    flex: 1,
  },
  suggestionUsername: {
    fontSize: 14,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  suggestionName: {
    fontSize: 12,
    color: COLORS.textGray,
    marginTop: 2,
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
  loadMoreButton: {
    marginTop: 20,
    padding: 15,
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  loadMoreText: {
    color: COLORS.primary,
    fontWeight: '600',
    fontSize: 14,
  },
});

export default PostDetailScreen;
