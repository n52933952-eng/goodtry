import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from 'react';
import { useIsFocused, useRoute, useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Image,
  Keyboard,
  Modal,
  TouchableWithoutFeedback,
  Dimensions,
  Animated,
  PanResponder,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import Post from '../../components/Post';
import ThreadedComment from '../../components/ThreadedComment';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useLanguage } from '../../context/LanguageContext';
import { usePost } from '../../context/PostContext';
import { pauseAllFeedVideos } from '../../utils/feedVideoPlayback';
import { hideChannelPostComments } from '../../utils/channelPostUtils';
import { useCollapsingHeader } from '../../hooks/useCollapsingHeader';
import CollapsingStackHeader from '../../components/CollapsingStackHeader';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_PARTIAL = Math.round(SCREEN_H * 0.72);
const SHEET_FULL = Math.round(SCREEN_H * 0.94);
const QUICK_EMOJIS = ['❤️', '🙌', '🔥', '👏', '😢', '😍', '😮', '😂'];
const COMMENTS_PAGE_SIZE = 12;

function mergeRepliesById(existing: any[], incoming: any[]) {
  const map = new Map(existing.map((r) => [String(r._id), r]));
  for (const r of incoming) map.set(String(r._id), r);
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}

const PostDetailScreen = ({ route, navigation }: any) => {
  const navRoute = useRoute<any>();
  const isFocused = useIsFocused();

  useFocusEffect(
    React.useCallback(() => {
      return () => {
        pauseAllFeedVideos();
      };
    }, []),
  );

  const { postId, fromScreen, userProfileParams, footballMatchId } =
    navRoute.params || route.params || {};
  const { user } = useUser();
  const { colors, theme } = useTheme();
  const showToast = useShowToast();
  const { t } = useLanguage();
  const { deletePost, updatePost } = usePost();

  const {
    translateY: headerTranslateY,
    mergeOnScroll,
    stackHeaderHeight,
  } = useCollapsingHeader({ forStackHeader: true });

  const handlePostDetailBack = useCallback(() => {
    if (navigation.canGoBack?.()) {
      navigation.goBack();
      return;
    }
    if (fromScreen === 'Notifications') {
      navigation.navigate('Notifications', { screen: 'NotificationsMain' });
      return;
    }
    if (fromScreen === 'UserProfile' && userProfileParams) {
      navigation.navigate('UserProfile', userProfileParams);
      return;
    }
    navigation.goBack();
  }, [fromScreen, navigation, userProfileParams]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTransparent: true,
      header: () => (
        <CollapsingStackHeader
          title="Post"
          translateY={headerTranslateY}
          backgroundColor={colors.backgroundLight}
          borderColor={colors.border}
          tintColor={colors.text}
          onBackPress={handlePostDetailBack}
        />
      ),
    });
  }, [navigation, colors, headerTranslateY, handlePostDetailBack]);
  const [post, setPost] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyParentId, setReplyParentId] = useState<string | null>(null); // null = top-level comment

  const [modalReplies, setModalReplies] = useState<any[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsLoadingMore, setCommentsLoadingMore] = useState(false);
  const [commentsHasMore, setCommentsHasMore] = useState(false);
  const commentsSkipRef = useRef(0);
  
  // Mention autocomplete state
  const [mentionSuggestions, setMentionSuggestions] = useState<any[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const replyInputRef = useRef<TextInput>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const modalScrollRef = useRef<ScrollView>(null);
  const [commentsVisible, setCommentsVisible] = useState(false);
  const mentionSearchGenRef = useRef(0);
  const sheetHeightAnim = useRef(new Animated.Value(SHEET_PARTIAL)).current;
  const sheetExpandedRef = useRef(false);
  const dragStartHeightRef = useRef(SHEET_PARTIAL);

  const resetSheetPosition = useCallback(() => {
    sheetHeightAnim.setValue(SHEET_PARTIAL);
    sheetExpandedRef.current = false;
    dragStartHeightRef.current = SHEET_PARTIAL;
  }, [sheetHeightAnim]);

  const clearMentionSuggestions = useCallback(() => {
    mentionSearchGenRef.current += 1;
    setShowSuggestions(false);
    setMentionSuggestions([]);
    setMentionStartIndex(-1);
    setSelectedSuggestionIndex(0);
  }, []);

  const closeCommentsModal = useCallback(() => {
    Keyboard.dismiss();
    setCommentsVisible(false);
    clearMentionSuggestions();
    resetSheetPosition();
  }, [clearMentionSuggestions, resetSheetPosition]);

  const snapSheet = useCallback(
    (toFull: boolean) => {
      sheetExpandedRef.current = toFull;
      const toValue = toFull ? SHEET_FULL : SHEET_PARTIAL;
      dragStartHeightRef.current = toValue;
      Animated.spring(sheetHeightAnim, {
        toValue,
        useNativeDriver: false,
        tension: 72,
        friction: 13,
      }).start();
    },
    [sheetHeightAnim],
  );

  useEffect(() => {
    if (commentsVisible) resetSheetPosition();
  }, [commentsVisible, resetSheetPosition]);

  const sheetPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          sheetHeightAnim.stopAnimation((value) => {
            dragStartHeightRef.current =
              typeof value === 'number' ? value : sheetExpandedRef.current ? SHEET_FULL : SHEET_PARTIAL;
          });
        },
        onPanResponderMove: (_, g) => {
          const next = dragStartHeightRef.current - g.dy;
          const minH = SHEET_PARTIAL * 0.55;
          sheetHeightAnim.setValue(Math.max(minH, Math.min(SHEET_FULL, next)));
        },
        onPanResponderRelease: (_, g) => {
          const isTap = Math.abs(g.dy) < 12 && Math.abs(g.dx) < 12;
          if (isTap) {
            snapSheet(!sheetExpandedRef.current);
            return;
          }

          const swipeUp = g.dy < -28 || g.vy < -0.25;
          const swipeDown = g.dy > 28 || g.vy > 0.25;

          if (swipeUp) {
            snapSheet(true);
            return;
          }
          if (swipeDown) {
            if (sheetExpandedRef.current) snapSheet(false);
            else closeCommentsModal();
            return;
          }

          sheetHeightAnim.stopAnimation((value) => {
            const v = typeof value === 'number' ? value : SHEET_PARTIAL;
            const mid = (SHEET_PARTIAL + SHEET_FULL) / 2;
            snapSheet(v >= mid);
          });
        },
      }),
    [sheetHeightAnim, snapSheet, closeCommentsModal],
  );

  useEffect(() => {
    fetchPost();
  }, [postId]);

  // Scroll comment list when mention suggestions open inside the modal
  useEffect(() => {
    if (!showSuggestions || mentionSuggestions.length === 0) return;
    const t = setTimeout(() => {
      modalScrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [showSuggestions, mentionSuggestions.length]);

  const scopedReplies = useMemo(() => {
    const all = Array.isArray(modalReplies) ? modalReplies : [];
    if (!footballMatchId) return all;
    const fid = String(footballMatchId);
    const roots = all.filter(
      (r: any) => !r?.parentReplyId && String(r?.footballMatchId || '') === fid,
    );
    const rootIds = new Set(roots.map((r: any) => String(r._id)));
    const inThread = new Set<string>(rootIds);
    let added = true;
    while (added) {
      added = false;
      for (const r of all) {
        const id = String(r._id);
        if (inThread.has(id)) continue;
        const p = r.parentReplyId ? String(r.parentReplyId) : '';
        if (p && inThread.has(p)) {
          inThread.add(id);
          added = true;
        }
      }
    }
    return all.filter((r: any) => inThread.has(String(r._id)));
  }, [modalReplies, footballMatchId]);

  const topLevelScopedReplies = useMemo(
    () => scopedReplies.filter((r: any) => !r?.parentReplyId),
    [scopedReplies],
  );

  const fetchCommentsPage = useCallback(
    async (loadMore: boolean) => {
      if (!postId) return;
      if (loadMore) {
        if (!commentsHasMore || commentsLoadingMore || commentsLoading) return;
        setCommentsLoadingMore(true);
      } else {
        if (commentsLoading) return;
        setCommentsLoading(true);
        commentsSkipRef.current = 0;
      }

      try {
        const skip = loadMore ? commentsSkipRef.current : 0;
        const query = new URLSearchParams({
          limit: String(COMMENTS_PAGE_SIZE),
          skip: String(skip),
        });
        if (footballMatchId) query.set('footballMatchId', String(footballMatchId));

        const data = await apiService.get(
          `${ENDPOINTS.GET_POST}/${postId}/comments?${query.toString()}`,
        );
        const batch = Array.isArray(data?.replies) ? data.replies : [];

        setModalReplies((prev) => (loadMore ? mergeRepliesById(prev, batch) : batch));
        setCommentsHasMore(!!data?.hasMore);
        commentsSkipRef.current = skip + COMMENTS_PAGE_SIZE;
      } catch (error: any) {
        console.error('❌ [PostDetail] Error fetching comments:', error);
        if (!loadMore) setModalReplies([]);
        showToast(t('error'), 'Failed to load comments', 'error');
      } finally {
        if (loadMore) setCommentsLoadingMore(false);
        else setCommentsLoading(false);
      }
    },
    [
      postId,
      footballMatchId,
      commentsHasMore,
      commentsLoadingMore,
      commentsLoading,
      showToast,
      t,
    ],
  );

  const openCommentsModal = useCallback(() => {
    setCommentsVisible(true);
  }, []);

  useEffect(() => {
    if (!commentsVisible || modalReplies.length > 0) return;
    fetchCommentsPage(false);
  }, [commentsVisible, postId, footballMatchId, modalReplies.length]);

  const handleCommentsScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
      const nearBottom =
        layoutMeasurement.height + contentOffset.y >= contentSize.height - 120;
      if (!nearBottom || commentsLoadingMore || commentsLoading || !commentsHasMore) return;
      fetchCommentsPage(true);
    },
    [commentsLoadingMore, commentsLoading, commentsHasMore, fetchCommentsPage],
  );

  const fetchPost = async () => {
    try {
      console.log('📥 [PostDetail] Fetching post:', postId);
      const data = await apiService.get(`${ENDPOINTS.GET_POST}/${postId}?includeReplies=0`);
      console.log('✅ [PostDetail] Post fetched:', data?._id);
      setPost(data);
      setModalReplies([]);
      setCommentsHasMore(false);
      commentsSkipRef.current = 0;
    } catch (error: any) {
      console.error('❌ [PostDetail] Error fetching post:', error);
      console.error('❌ [PostDetail] Post ID:', postId);
      const msg = String(error?.message || '');
      const missing =
        msg.toLowerCase().includes('no post') ||
        msg.toLowerCase().includes('not found') ||
        msg.toLowerCase().includes('post not found');

      if (missing) {
        // If post was deleted (e.g., author deleted account), remove it from local lists and exit safely.
        if (postId) deletePost(String(postId));
        showToast(t('info'), t('postNotFound'), 'info');
        setPost(null);
        // Navigate away to avoid leaving user on a dead detail screen.
        if (navigation.canGoBack?.()) navigation.goBack();
        return;
      }

      showToast(t('error'), 'Failed to load post', 'error');
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
  const searchMentionUsers = async (searchTerm: string, requestGen: number) => {
    if (requestGen !== mentionSearchGenRef.current) return;

    if (!searchTerm || searchTerm.length < 1) {
      if (requestGen !== mentionSearchGenRef.current) return;
      setMentionSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    try {
      const users = await apiService.get(`${ENDPOINTS.SEARCH_USERS}?search=${encodeURIComponent(searchTerm)}`);
      if (requestGen !== mentionSearchGenRef.current) return;

      const filteredUsers = Array.isArray(users)
        ? users.filter((u: any) => !channelUsernames.includes(u.username))
        : [];
      setMentionSuggestions(filteredUsers);
      setShowSuggestions(filteredUsers.length > 0);
      setSelectedSuggestionIndex(0);
    } catch (error) {
      console.error('Error searching users:', error);
      if (requestGen !== mentionSearchGenRef.current) return;
      setMentionSuggestions([]);
      setShowSuggestions(false);
    }
  };

  // Handle text input change and detect @mentions
  const handleReplyTextChange = (text: string) => {
    setReplyText(text);

    if (!text || !text.trim()) {
      clearMentionSuggestions();
      return;
    }

    const lastAtIndex = text.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = text.substring(lastAtIndex + 1);
      const spaceIndex = textAfterAt.indexOf(' ');
      const newlineIndex = textAfterAt.indexOf('\n');
      const endIndex =
        spaceIndex !== -1 || newlineIndex !== -1
          ? Math.min(
              spaceIndex !== -1 ? spaceIndex : Infinity,
              newlineIndex !== -1 ? newlineIndex : Infinity,
            )
          : textAfterAt.length;

      const mentionTerm = textAfterAt.substring(0, endIndex);

      if (endIndex === textAfterAt.length) {
        setMentionStartIndex(lastAtIndex);
        const gen = ++mentionSearchGenRef.current;
        if (!mentionTerm) {
          mentionSearchGenRef.current += 1;
          setMentionSuggestions([]);
          setShowSuggestions(false);
          return;
        }
        searchMentionUsers(mentionTerm, gen);
      } else {
        clearMentionSuggestions();
      }
    } else {
      clearMentionSuggestions();
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
    clearMentionSuggestions();
    
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
        ...(!replyParentId && footballMatchId ? { footballMatchId: String(footballMatchId) } : {}),
      });

      const replyWithLikes = { ...data, likes: data?.likes || [] };
      const nextReplyCount =
        (typeof post?.replyCount === 'number' ? post.replyCount : 0) + 1;

      setModalReplies((prev) => mergeRepliesById(prev, [replyWithLikes]));
      setPost((prev: any) => ({ ...prev, replyCount: nextReplyCount }));
      updatePost(String(postId), { replyCount: nextReplyCount });
      setReplyText('');
      setReplyParentId(null);
      clearMentionSuggestions();
      
      // Scroll to the newly posted comment after a delay to ensure it's rendered
      setTimeout(() => {
        modalScrollRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // Additional scroll after a longer delay to ensure smooth animation
      setTimeout(() => {
        modalScrollRef.current?.scrollToEnd({ animated: true });
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

      setModalReplies((prev) => {
        const updated = prev.map((r: any) => {
          const rId = r?._id?.toString?.() ?? String(r?._id);
          if (rId !== replyId) return r;

          const likesArr = Array.isArray(r?.likes) ? r.likes : [];
          const userIdStr = user._id?.toString?.() ?? String(user._id);
          const nextLikes = data?.isLiked
            ? [...likesArr, userIdStr]
            : likesArr.filter((id: any) => (id?.toString?.() ?? String(id)) !== userIdStr);

          return { ...r, likes: nextLikes };
        });
        return updated;
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
      const filtered = removeReplyAndDescendants(modalReplies, replyId);
      const removedCount = modalReplies.length - filtered.length;
      setModalReplies(filtered);
      if (removedCount > 0) {
        const nextReplyCount = Math.max(
          0,
          (typeof post?.replyCount === 'number' ? post.replyCount : modalReplies.length) -
            removedCount,
        );
        setPost((p: any) => ({ ...p, replyCount: nextReplyCount }));
        updatePost(String(postId), { replyCount: nextReplyCount });
      }
      showToast(t('success'), t('commentDeletedSuccessfully'), 'success');
    } catch (error: any) {
      showToast(t('error'), error.message || t('failedToDeleteComment'), 'error');
    }
  };

  const handleReplyPress = (reply: any) => {
    const username = reply?.username || '';
    setReplyParentId(reply?._id?.toString?.() ?? String(reply._id));
    setReplyText(username ? `@${username} ` : '');
    setCommentsVisible(true);
    setTimeout(() => replyInputRef.current?.focus(), 300);
  };

  const appendEmoji = (emoji: string) => {
    setReplyText((prev) => `${prev}${emoji}`);
    replyInputRef.current?.focus();
  };

  const postAuthorName =
    post?.postedBy?.username || post?.postedBy?.name || 'this post';

  const isDark = theme === 'dark';
  const sheetUi = useMemo(
    () => ({
      bg: isDark ? '#1C1C1E' : '#FFFFFF',
      footer: isDark ? '#1C1C1E' : '#FFFFFF',
      inputFill: isDark ? '#2C2C2E' : '#F2F2F7',
      inputBorder: isDark ? '#3A3A3C' : '#E5E5EA',
      handle: isDark ? '#636366' : '#C7C7CC',
      divider: isDark ? '#38383A' : '#EBEBEB',
      backdrop: isDark ? 'rgba(0,0,0,0.78)' : 'rgba(0,0,0,0.48)',
      muted: isDark ? '#98989F' : '#8E8E93',
      accent: '#0095F6',
    }),
    [isDark],
  );

  const hideChannelPostCommentsFlag = useMemo(
    () => hideChannelPostComments(post),
    [post],
  );

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>{t('postNotFound')}</Text>
      </View>
    );
  }

  const suggestionsListHeight = Math.min(Math.max(mentionSuggestions.length * 62, 120), 260);

  const commentsCount =
    typeof post?.replyCount === 'number' ? post.replyCount : topLevelScopedReplies.length;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollViewRef}
        style={[styles.content, { backgroundColor: colors.background }]}
        contentContainerStyle={[styles.contentContainer, { paddingTop: stackHeaderHeight }]}
        onScroll={mergeOnScroll()}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchPost();
            }}
            tintColor={colors.primary}
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        <Post
          post={post}
          disableNavigation={true}
          screenFocused={isFocused}
          autoPlayMedia={isFocused}
          onPostUpdated={setPost}
          footballFocusMatchId={footballMatchId}
          fullWidthCard
          onCommentPress={hideChannelPostCommentsFlag ? undefined : openCommentsModal}
        />

        {!hideChannelPostCommentsFlag && (
        <TouchableOpacity
          style={styles.viewCommentsRow}
          onPress={openCommentsModal}
          activeOpacity={0.7}
        >
          <Text style={[styles.viewCommentsText, { color: colors.textGray }]}>
            {commentsCount > 0
              ? `View all ${commentsCount} comments`
              : 'Add a comment…'}
          </Text>
        </TouchableOpacity>
        )}
      </ScrollView>

      {/* Instagram-style comments bottom sheet */}
      <Modal
        visible={commentsVisible}
        transparent
        animationType="slide"
        onRequestClose={closeCommentsModal}
        statusBarTranslucent
      >
        <View style={styles.sheetRoot}>
          <TouchableWithoutFeedback onPress={closeCommentsModal}>
            <View style={[styles.sheetBackdrop, { backgroundColor: sheetUi.backdrop }]} />
          </TouchableWithoutFeedback>

          <Animated.View style={[styles.sheetKav, { height: sheetHeightAnim }]}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.sheetKavInner}
            >
              <View style={[styles.sheet, styles.sheetShadow, { backgroundColor: sheetUi.bg, flex: 1 }]}>
                <View style={styles.sheetDragZone} {...sheetPanResponder.panHandlers}>
                  <View style={styles.sheetHandleWrap}>
                    <View style={[styles.sheetHandle, { backgroundColor: sheetUi.handle }]} />
                  </View>
                  <View style={styles.sheetHeader}>
                    <Text style={[styles.sheetTitle, { color: colors.text }]}>Comments</Text>
                  </View>
                  <View style={[styles.sheetDivider, { backgroundColor: sheetUi.divider }]} />
                </View>

              <ScrollView
                ref={modalScrollRef}
                style={styles.commentsScroll}
                contentContainerStyle={styles.commentsScrollContent}
                keyboardShouldPersistTaps="handled"
                scrollEnabled={!showSuggestions}
                nestedScrollEnabled
                showsVerticalScrollIndicator={topLevelScopedReplies.length > 4}
                scrollEventThrottle={16}
                onScroll={handleCommentsScroll}
              >
                {commentsLoading && topLevelScopedReplies.length === 0 ? (
                  <ActivityIndicator
                    size="small"
                    color={sheetUi.accent}
                    style={styles.commentsLoader}
                  />
                ) : topLevelScopedReplies.length === 0 ? (
                  <Text style={[styles.noCommentsText, { color: sheetUi.muted }]}>
                    No comments yet. Start the conversation.
                  </Text>
                ) : (
                  topLevelScopedReplies.map((reply: any) => (
                    <ThreadedComment
                      key={reply?._id?.toString?.() ?? String(reply?._id)}
                      reply={reply}
                      allReplies={scopedReplies}
                      postId={postId}
                      postOwnerId={post?.postedBy?._id?.toString?.() ?? String(post?.postedBy)}
                      currentUserId={user?._id?.toString?.() ?? String(user?._id)}
                      currentUserProfilePic={user?.profilePic}
                      onReplyPress={handleReplyPress}
                      onLikePress={handleLikeComment}
                      onDeletePress={handleDeleteComment}
                      onMentionPress={(username: string) => {
                        closeCommentsModal();
                        navigation.navigate('UserProfile', { username });
                      }}
                    />
                  ))
                )}

                {commentsLoadingMore && (
                  <ActivityIndicator
                    size="small"
                    color={sheetUi.accent}
                    style={styles.commentsLoaderMore}
                  />
                )}

              </ScrollView>

              {/* Mention suggestions above input */}
              {showSuggestions && mentionSuggestions.length > 0 && (
                <View
                  style={[
                    styles.suggestionsPanel,
                    {
                      backgroundColor: sheetUi.inputFill,
                      borderColor: sheetUi.inputBorder,
                      height: suggestionsListHeight,
                    },
                  ]}
                >
                  <GestureScrollView
                    style={styles.suggestionsList}
                    contentContainerStyle={styles.suggestionsListContent}
                    keyboardShouldPersistTaps="always"
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                    bounces={false}
                    scrollEventThrottle={16}
                  >
                    {mentionSuggestions.map((item, index) => (
                      <Pressable
                        key={item._id?.toString() || item.username || String(index)}
                        style={({ pressed }) => [
                          styles.suggestionItem,
                          {
                            backgroundColor:
                              index === selectedSuggestionIndex
                                ? colors.border
                                : pressed
                                  ? colors.border
                                  : 'transparent',
                          },
                        ]}
                        onPress={() => selectMentionUser(item)}
                      >
                        {item.profilePic ? (
                          <Image source={{ uri: item.profilePic }} style={styles.suggestionAvatar} />
                        ) : (
                          <View style={[styles.suggestionAvatar, styles.suggestionAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                            <Text style={styles.suggestionAvatarText}>
                              {(item.username || '?')[0]?.toUpperCase() || '?'}
                            </Text>
                          </View>
                        )}
                        <View style={styles.suggestionInfo}>
                          <Text style={[styles.suggestionUsername, { color: colors.text }]}>{item.username}</Text>
                          {item.name ? (
                            <Text style={[styles.suggestionName, { color: colors.textGray }]} numberOfLines={1}>
                              {item.name}
                            </Text>
                          ) : null}
                        </View>
                      </Pressable>
                    ))}
                  </GestureScrollView>
                </View>
              )}

              {/* Quick emoji row — Instagram style */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={[styles.emojiRow, { borderTopColor: sheetUi.divider, backgroundColor: sheetUi.footer }]}
                contentContainerStyle={styles.emojiRowContent}
                keyboardShouldPersistTaps="handled"
              >
                {QUICK_EMOJIS.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={styles.emojiBtn}
                    onPress={() => appendEmoji(emoji)}
                    hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
                  >
                    <Text style={styles.emojiChar}>{emoji}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={[styles.inputContainer, { backgroundColor: sheetUi.footer, borderTopColor: sheetUi.divider }]}>
                {user?.profilePic ? (
                  <Image source={{ uri: user.profilePic }} style={styles.inputAvatar} />
                ) : (
                  <View style={[styles.inputAvatar, styles.inputAvatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
                    <Text style={styles.inputAvatarText}>
                      {(user?.username || '?')[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={[styles.inputPill, { borderColor: sheetUi.inputBorder, backgroundColor: sheetUi.inputFill }]}>
                  <TextInput
                    ref={replyInputRef}
                    style={[styles.input, { color: colors.text }]}
                    placeholder={
                      replyParentId
                        ? t('writeReplyToComment')
                        : `Add a comment for ${postAuthorName}…`
                    }
                    placeholderTextColor={sheetUi.muted}
                    value={replyText}
                    onChangeText={handleReplyTextChange}
                    multiline
                  />
                </View>
                {replyText.trim().length > 0 && (
                  <TouchableOpacity style={styles.postButton} onPress={handleReply} disabled={replying}>
                    {replying ? (
                      <ActivityIndicator size="small" color={sheetUi.accent} />
                    ) : (
                      <Text style={[styles.postButtonText, { color: sheetUi.accent }]}>Post</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
            </KeyboardAvoidingView>
          </Animated.View>
        </View>
      </Modal>
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
    paddingBottom: 24,
  },
  viewCommentsRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  viewCommentsText: {
    fontSize: 14,
    fontWeight: '400',
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheetShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.28,
    shadowRadius: 16,
    elevation: 28,
  },
  sheetKav: {
    width: '100%',
  },
  sheetKavInner: {
    flex: 1,
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
  },
  sheetDragZone: {
    width: '100%',
    paddingBottom: 2,
  },
  sheetHandleWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingTop: 10,
    paddingBottom: 14,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.35,
  },
  sheetHeader: {
    alignItems: 'center',
    paddingBottom: 12,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sheetDivider: {
    height: StyleSheet.hairlineWidth,
  },
  commentsScroll: {
    flex: 1,
    minHeight: 0,
  },
  commentsScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 8,
  },
  noCommentsText: {
    textAlign: 'center',
    fontSize: 14,
    paddingVertical: 40,
  },
  commentsLoader: {
    paddingVertical: 32,
  },
  commentsLoaderMore: {
    paddingVertical: 16,
  },
  loadMoreInline: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  emojiRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 44,
  },
  emojiRowContent: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 2,
    alignItems: 'center',
  },
  emojiBtn: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  emojiChar: {
    fontSize: 22,
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
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  inputAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 10,
  },
  inputAvatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  inputAvatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  inputPill: {
    flex: 1,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    minHeight: 40,
    justifyContent: 'center',
  },
  inputWrapper: {
    flex: 1,
    marginRight: 10,
  },
  input: {
    fontSize: 14,
    lineHeight: 18,
    padding: 0,
    margin: 0,
    maxHeight: 80,
  },
  postButton: {
    paddingLeft: 10,
    justifyContent: 'center',
    minWidth: 44,
    alignItems: 'center',
  },
  postButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  suggestionsPanel: {
    marginHorizontal: 15,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  suggestionsList: {
    flex: 1,
  },
  suggestionsListContent: {
    flexGrow: 0,
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
