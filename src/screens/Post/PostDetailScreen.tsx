import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const PostDetailScreen = ({ route, navigation }: any) => {
  const { postId } = route.params;
  const { user } = useUser();
  const showToast = useShowToast();

  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);

  useEffect(() => {
    fetchPost();
  }, [postId]);

  const fetchPost = async () => {
    try {
      const data = await apiService.get(`${ENDPOINTS.GET_POST}/${postId}`);
      setPost(data);
    } catch (error: any) {
      showToast('Error', 'Failed to load post', 'error');
      navigation.goBack();
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleReply = async () => {
    if (!replyText.trim()) {
      showToast('Error', 'Please enter a reply', 'error');
      return;
    }

    setReplying(true);
    try {
      const data = await apiService.put(`${ENDPOINTS.REPLY_POST}/${postId}`, {
        text: replyText.trim(),
      });
      setPost(data);
      setReplyText('');
      showToast('Success', 'Reply posted!', 'success');
    } catch (error: any) {
      showToast('Error', error.message || 'Failed to post reply', 'error');
    } finally {
      setReplying(false);
    }
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
        <Text style={styles.errorText}>Post not found</Text>
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
          <Text style={styles.backButton}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView
        style={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchPost();
            }}
          />
        }
      >
        <Post post={post} />

        <View style={styles.repliesSection}>
          <Text style={styles.repliesTitle}>Replies ({post.replies?.length || 0})</Text>
          {post.replies?.map((reply: any, index: number) => (
            <View key={index} style={styles.replyItem}>
              <Text style={styles.replyAuthor}>
                {reply.postedBy?.name || 'Unknown'} @{reply.postedBy?.username}
              </Text>
              <Text style={styles.replyText}>{reply.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Write a reply..."
          placeholderTextColor={COLORS.textGray}
          value={replyText}
          onChangeText={setReplyText}
          multiline
        />
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backButton: {
    fontSize: 16,
    color: COLORS.primary,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  content: {
    flex: 1,
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

export default PostDetailScreen;
