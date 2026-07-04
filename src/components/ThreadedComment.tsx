import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type AnyReply = any;

function formatTimeAgo(dateValue?: string) {
  if (!dateValue) return 'now';
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return 'now';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  if (diffWeeks < 4) return `${diffWeeks}w`;
  return date.toLocaleDateString();
}

type Props = {
  reply: AnyReply;
  allReplies: AnyReply[];
  postId: string;
  postOwnerId?: string;
  currentUserId?: string;
  currentUserProfilePic?: string;
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
  currentUserProfilePic,
  depth = 0,
  onReplyPress,
  onLikePress,
  onDeletePress,
  onMentionPress,
}) => {
  const { colors } = useTheme();
  const replyId = reply?._id?.toString?.() ?? String(reply?._id);
  const replyUserId = reply?.userId?.toString?.() ?? String(reply?.userId);

  const [showReplies, setShowReplies] = useState(depth === 0 && false);

  const canDelete =
    !!currentUserId &&
    (postOwnerId?.toString() === currentUserId?.toString() ||
      replyUserId === currentUserId?.toString());

  const isOwnComment = replyUserId === currentUserId?.toString();
  const avatarPic =
    isOwnComment && currentUserProfilePic ? currentUserProfilePic : reply?.userProfilePic;

  const liked = useMemo(() => {
    const likes = Array.isArray(reply?.likes) ? reply.likes : [];
    if (!currentUserId) return false;
    return likes.some(
      (id: any) => (id?.toString?.() ?? String(id)) === currentUserId?.toString(),
    );
  }, [reply?.likes, currentUserId]);

  const likesCount = Array.isArray(reply?.likes) ? reply.likes.length : 0;

  const nestedReplies = useMemo(() => {
    return (allReplies || []).filter((r: any) => {
      const parent =
        r?.parentReplyId?.toString?.() ?? (r?.parentReplyId ? String(r.parentReplyId) : null);
      return parent && parent === replyId;
    });
  }, [allReplies, replyId]);

  const isNested = depth > 0;
  const avatarSize = isNested ? 28 : 32;

  const renderBody = () => {
    const text = reply?.text || '';
    const parts = text.split(/(@\w+)/g);
    return (
      <Text style={[styles.bodyText, { color: colors.text }]}>
        <Text style={[styles.usernameInline, { color: colors.text }]}>
          {reply?.username || 'Unknown'}{' '}
        </Text>
        {parts.map((part, idx) => {
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
          return <Text key={`${idx}-${part}`}>{part}</Text>;
        })}
      </Text>
    );
  };

  return (
    <View style={[styles.container, isNested && styles.nestedContainer]}>
      <View style={styles.row}>
        {avatarPic ? (
          <Image
            source={{ uri: avatarPic }}
            style={[styles.avatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }]}
          />
        ) : (
          <View
            style={[
              styles.avatar,
              styles.avatarPlaceholder,
              { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, backgroundColor: colors.avatarBg },
            ]}
          >
            <Text style={styles.avatarText}>
              {(reply?.username || '?')[0]?.toUpperCase?.() || '?'}
            </Text>
          </View>
        )}

        <View style={styles.content}>
          {renderBody()}

          <View style={styles.metaRow}>
            <Text style={[styles.metaText, { color: colors.textGray }]}>
              {formatTimeAgo(reply?.date)}
            </Text>
            <TouchableOpacity onPress={() => onReplyPress(reply)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Text style={[styles.metaAction, { color: colors.textGray }]}>Reply</Text>
            </TouchableOpacity>
            {canDelete && (
              <TouchableOpacity onPress={() => onDeletePress(reply)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
                <Text style={[styles.metaAction, { color: colors.textGray }]}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.likeCol}
          onPress={() => onLikePress(reply)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={[styles.heart, liked && styles.heartLiked]}>{liked ? '❤️' : '♡'}</Text>
          {likesCount > 0 && (
            <Text style={[styles.likeCount, { color: colors.textGray }]}>{likesCount}</Text>
          )}
        </TouchableOpacity>
      </View>

      {depth === 0 && nestedReplies.length > 0 && (
        <View style={styles.nestedWrap}>
          {!showReplies ? (
            <TouchableOpacity
              style={styles.viewRepliesRow}
              onPress={() => setShowReplies(true)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            >
              <View style={[styles.viewRepliesLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.viewRepliesText, { color: colors.textGray }]}>
                {nestedReplies.length === 1
                  ? 'View 1 reply'
                  : `View ${nestedReplies.length} more replies`}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              {nestedReplies.map((nr: any) => (
                <ThreadedComment
                  key={nr?._id?.toString?.() ?? String(nr?._id)}
                  reply={nr}
                  allReplies={allReplies}
                  postId={postId}
                  postOwnerId={postOwnerId}
                  currentUserId={currentUserId}
                  currentUserProfilePic={currentUserProfilePic}
                  depth={depth + 1}
                  onReplyPress={onReplyPress}
                  onLikePress={onLikePress}
                  onDeletePress={onDeletePress}
                  onMentionPress={onMentionPress}
                />
              ))}
              <TouchableOpacity
                style={styles.viewRepliesRow}
                onPress={() => setShowReplies(false)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <View style={[styles.viewRepliesLine, { backgroundColor: colors.border }]} />
                <Text style={[styles.viewRepliesText, { color: colors.textGray }]}>Hide replies</Text>
              </TouchableOpacity>
            </>
          )}
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
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  avatar: {
    marginRight: 12,
    backgroundColor: '#eee',
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 12,
  },
  content: {
    flex: 1,
    paddingRight: 4,
  },
  bodyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  usernameInline: {
    fontWeight: '700',
    fontSize: 14,
    lineHeight: 20,
  },
  mention: {
    color: '#0095F6',
    fontWeight: '600',
    fontSize: 14,
    lineHeight: 20,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  metaText: {
    fontSize: 12,
    fontWeight: '600',
  },
  metaAction: {
    fontSize: 12,
    fontWeight: '700',
  },
  likeCol: {
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 2,
    minWidth: 28,
    marginLeft: 4,
  },
  heart: {
    fontSize: 13,
    color: '#262626',
  },
  heartLiked: {
    fontSize: 12,
  },
  likeCount: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 3,
  },
  nestedWrap: {
    marginLeft: 44,
    marginTop: 2,
  },
  viewRepliesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  viewRepliesLine: {
    width: 22,
    height: StyleSheet.hairlineWidth,
  },
  viewRepliesText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default ThreadedComment;
