import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  FlatList,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';

const PAGE_SIZE = 20;
const SCREEN_HEIGHT = Dimensions.get('window').height;

interface Liker {
  _id: string;
  username: string;
  name?: string;
  profilePic?: string;
}

interface PostLikesModalProps {
  visible: boolean;
  postId: string | null;
  /** Optional starting count for the header while the first page loads. */
  initialCount?: number;
  onClose: () => void;
  /** Called with a username when a row is tapped (parent handles navigation). */
  onPressUser: (username: string) => void;
}

/**
 * Instagram-style half-screen sheet listing who liked a post.
 * Cursor-paginated so it stays light even on posts with huge like counts.
 */
const PostLikesModal: React.FC<PostLikesModalProps> = ({
  visible,
  postId,
  initialCount,
  onClose,
  onPressUser,
}) => {
  const { colors } = useTheme();

  const [users, setUsers] = useState<Liker[]>([]);
  const [total, setTotal] = useState<number>(initialCount ?? 0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const seenRef = useRef<Set<string>>(new Set());

  const fetchPage = useCallback(
    async (isFirst: boolean) => {
      if (!postId) return;
      if (isFirst) {
        setLoading(true);
        setError(null);
      } else {
        if (!hasMoreRef.current || loadingMore) return;
        setLoadingMore(true);
      }
      try {
        const parts = [`limit=${PAGE_SIZE}`];
        if (!isFirst && cursorRef.current) {
          parts.push(`cursor=${encodeURIComponent(cursorRef.current)}`);
        }
        const data = await apiService.get(
          `${ENDPOINTS.GET_POST_LIKES}/${postId}?${parts.join('&')}`,
        );
        const page: Liker[] = Array.isArray(data?.users) ? data.users : [];
        cursorRef.current = data?.nextCursor ?? null;
        hasMoreRef.current = !!data?.hasMore && !!data?.nextCursor;
        if (typeof data?.total === 'number') setTotal(data.total);

        if (isFirst) {
          seenRef.current = new Set(page.map((u) => String(u._id)));
          setUsers(page);
        } else {
          setUsers((prev) => {
            const merged = [...prev];
            for (const u of page) {
              const id = String(u._id);
              if (id && !seenRef.current.has(id)) {
                seenRef.current.add(id);
                merged.push(u);
              }
            }
            return merged;
          });
        }
      } catch (e: any) {
        if (isFirst) setError(e?.message || 'Failed to load likes');
      } finally {
        if (isFirst) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [postId, loadingMore],
  );

  // (Re)load whenever the sheet opens for a post.
  useEffect(() => {
    if (!visible || !postId) return;
    cursorRef.current = null;
    hasMoreRef.current = true;
    seenRef.current = new Set();
    setUsers([]);
    setTotal(initialCount ?? 0);
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, postId]);

  const handleLoadMore = useCallback(() => {
    if (!loading && !loadingMore && hasMoreRef.current) fetchPage(false);
  }, [fetchPage, loading, loadingMore]);

  const handlePressUser = useCallback(
    (username?: string) => {
      if (!username) return;
      onClose();
      // Let the sheet close before navigating for a smoother transition.
      setTimeout(() => onPressUser(username), 180);
    },
    [onClose, onPressUser],
  );

  const renderItem = useCallback(
    ({ item }: { item: Liker }) => (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.7}
        onPress={() => handlePressUser(item.username)}
      >
        {item.profilePic ? (
          <Image source={{ uri: item.profilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.avatarLetter, { color: colors.text }]}>
              {(item.name || item.username || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.rowText}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {item.name || item.username}
          </Text>
          <Text style={[styles.username, { color: colors.textGray }]} numberOfLines={1}>
            @{item.username}
          </Text>
        </View>
      </TouchableOpacity>
    ),
    [colors.border, colors.text, colors.textGray, handlePressUser],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.handleWrap}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
          </View>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <Text style={[styles.headerTitle, { color: colors.text }]}>
              {total > 0 ? `${total.toLocaleString()} ${total === 1 ? 'like' : 'likes'}` : 'Likes'}
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={[styles.closeText, { color: colors.textGray }]}>✕</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={styles.centerFill}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : error ? (
            <View style={styles.centerFill}>
              <Text style={[styles.emptyText, { color: colors.textGray }]}>{error}</Text>
            </View>
          ) : (
            <FlatList
              style={styles.list}
              data={users}
              keyExtractor={(item, index) => item._id?.toString() || `liker-${index}`}
              renderItem={renderItem}
              onEndReached={handleLoadMore}
              onEndReachedThreshold={0.4}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={users.length === 0 ? styles.emptyContainer : styles.listContent}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: colors.textGray }]}>No likes yet</Text>
              }
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.footerLoading}>
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : null
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    height: SCREEN_HEIGHT * 0.62,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
    direction: 'ltr',
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    direction: 'ltr',
  },
  headerTitle: { fontSize: 16, fontWeight: '700', textAlign: 'left', writingDirection: 'ltr' },
  closeText: { fontSize: 18, fontWeight: '600' },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  list: { direction: 'ltr' },
  listContent: { paddingVertical: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    direction: 'ltr',
  },
  avatar: { width: 46, height: 46, borderRadius: 23, marginRight: 12 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  avatarLetter: { fontSize: 18, fontWeight: '700' },
  rowText: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  name: {
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'left',
    writingDirection: 'ltr',
    alignSelf: 'stretch',
  },
  username: {
    fontSize: 13,
    marginTop: 2,
    textAlign: 'left',
    writingDirection: 'ltr',
    alignSelf: 'stretch',
  },
  footerLoading: { paddingVertical: 16, alignItems: 'center' },
  emptyText: { textAlign: 'center', fontSize: 15, paddingHorizontal: 24 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', paddingTop: 40 },
});

export default PostLikesModal;
