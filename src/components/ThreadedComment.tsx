import React, { useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS } from '../utils/constants';

type AnyReply = any;

function formatTimeAgo(dateValue?: string) {
  if (!dateValue) return 'just now';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'just now';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString();
}

function renderTextWithMentions(text: string, onMentionPress?: (username: string) => void) {
  // Split on @mentions (same pattern as web: @\w+)
  const parts = (text || '').split(/(@\w+)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('@') && part.length > 1) {
      const username = part.slice(1);
      return (
        <Text
          key={`${idx}-${part}`}
          style={styles.mention}
          onPress={() => onMentionPress?.(username)}
        >
          {part}
        </Text>
      );
    }
    return (
      <Text key={`${idx}-${part}`} style={styles.commentText}>
        {part}
      </Text>
    );
  });
}

type Props = {
  reply: AnyReply;
  allReplies: AnyReply[];
  postId: string;
  postOwnerId?: string;
  currentUserId?: string;
  depth?: number;
  onReplyPress: (reply: AnyReply) => void;
  onLikePress: (reply: AnyReply) => void;
  onDeletePress: (reply: AnyReply) => void;
  onMentionPress?: (username: string) => void;
};

export const ThreadedComment: React.FC<Props> = ({
  reply,
  allReplies,
  postId,
  postOwnerId,
  currentUserId,
  depth = 0,
  onReplyPress,
  onLikePress,
  onDeletePress,
  onMentionPress,
}) => {
  const replyId = reply?._id?.toString?.() ?? String(reply?._id);
  const replyUserId = reply?.userId?.toString?.() ?? String(reply?.userId);

  const canDelete = !!currentUserId && (postOwnerId?.toString() === currentUserId?.toString() || replyUserId === currentUserId?.toString());

  const liked = useMemo(() => {
    const likes = Array.isArray(reply?.likes) ? reply.likes : [];
    if (!currentUserId) return false;
    return likes.some((id: any) => (id?.toString?.() ?? String(id)) === currentUserId?.toString());
  }, [reply?.likes, currentUserId]);

  const likesCount = Array.isArray(reply?.likes) ? reply.likes.length : 0;

  const nestedReplies = useMemo(() => {
    return (allReplies || []).filter((r: any) => {
      const parent = r?.parentReplyId?.toString?.() ?? (r?.parentReplyId ? String(r.parentReplyId) : null);
      return parent && parent === replyId;
    });
  }, [allReplies, replyId]);

  return (
    <View style={[styles.container, depth > 0 && styles.nestedContainer]}>
      <View style={styles.row}>
        {reply?.userProfilePic ? (
          <Image source={{ uri: reply.userProfilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarText}>{(reply?.username || '?')[0]?.toUpperCase?.() || '?'}</Text>
          </View>
        )}

        <View style={styles.content}>
          <View style={styles.headerRow}>
            <Text style={styles.username}>{reply?.username || 'Unknown'}</Text>
            <Text style={styles.time}>· {formatTimeAgo(reply?.date)}</Text>
            <View style={{ flex: 1 }} />
            {canDelete && (
              <TouchableOpacity onPress={() => onDeletePress(reply)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.delete}>🗑️</Text>
              </TouchableOpacity>
            )}
          </View>

          <Text style={styles.commentText}>
            {renderTextWithMentions(reply?.text || '', onMentionPress)}
          </Text>

          <View style={styles.actionsRow}>
            <TouchableOpacity onPress={() => onReplyPress(reply)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.action}>Reply</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => onLikePress(reply)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.action}>{liked ? '❤️' : '🤍'} {likesCount}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {nestedReplies.length > 0 && (
        <View style={styles.nestedList}>
          {nestedReplies.map((nr: any) => (
            <ThreadedComment
              key={nr?._id?.toString?.() ?? String(nr?._id)}
              reply={nr}
              allReplies={allReplies}
              postId={postId}
              postOwnerId={postOwnerId}
              currentUserId={currentUserId}
              depth={depth + 1}
              onReplyPress={onReplyPress}
              onLikePress={onLikePress}
              onDeletePress={onDeletePress}
              onMentionPress={onMentionPress}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  nestedContainer: {
    marginLeft: 18,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    paddingLeft: 12,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.backgroundLight,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.primary,
  },
  avatarText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  content: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  username: {
    fontWeight: 'bold',
    color: COLORS.text,
  },
  time: {
    color: COLORS.textGray,
    fontSize: 12,
  },
  delete: {
    fontSize: 16,
  },
  commentText: {
    color: COLORS.text,
    marginTop: 4,
    lineHeight: 18,
  },
  mention: {
    color: '#3B82F6',
    fontWeight: 'bold',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  action: {
    color: COLORS.textGray,
    fontSize: 12,
    fontWeight: '600',
  },
  nestedList: {
    marginTop: 6,
  },
});

export default ThreadedComment;
