import React, { memo, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Platform,
  Alert,
} from 'react-native';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';

const LTR_TEXT = {
  textAlign: 'left' as const,
  writingDirection: 'ltr' as const,
};

const LIST_AVATAR = 50;

type Props = {
  item: any;
  borderColor: string;
  textColor: string;
  textGray: string;
  primaryColor: string;
  avatarBg: string;
  successColor: string;
  backgroundColor: string;
  isOnline: boolean;
  hasStory: boolean;
  hasUnviewedStory: boolean;
  unknownLabel: string;
  noMessagesLabel: string;
  deleteTitle: string;
  deleteWarning: string;
  cancelLabel: string;
  deleteLabel: string;
  errorLabel: string;
  deleteFailedLabel: string;
  onOpen: (item: any) => void;
  onAvatarPress: (userId: string, user: any) => void;
  onRemoved: (conversationId: string) => void;
  getOtherUser: (conversation: any) => any;
};

const formatTime = (dateString: string) => {
  const date = new Date(dateString);
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
};

const ConversationListItem = ({
  item,
  borderColor,
  textColor,
  textGray,
  primaryColor,
  avatarBg,
  successColor,
  backgroundColor,
  isOnline,
  hasStory,
  hasUnviewedStory,
  unknownLabel,
  noMessagesLabel,
  deleteTitle,
  deleteWarning,
  cancelLabel,
  deleteLabel,
  errorLabel,
  deleteFailedLabel,
  onOpen,
  onAvatarPress,
  onRemoved,
  getOtherUser,
}: Props) => {
  const isGroupConv = !!item.isGroup;
  const otherUser = isGroupConv ? null : getOtherUser(item);
  if (!isGroupConv && !otherUser) return null;

  const otherUserData = !isGroupConv && typeof otherUser !== 'string' ? otherUser : null;
  const otherUserId = !isGroupConv && otherUser
    ? (typeof otherUser === 'string' ? otherUser : otherUser?._id)
    : null;
  const unreadCount = item.unreadCount || 0;
  const displayName = isGroupConv ? (item.groupName || 'Group') : (otherUserData?.name || unknownLabel);
  const timeLabel = item.lastMessage
    ? formatTime(item.lastMessage.createdAt || item.updatedAt)
    : '';

  const storyRingStyle = useMemo(
    () => ({
      borderColor: hasUnviewedStory ? '#FF3040' : '#9CA3AF',
    }),
    [hasUnviewedStory],
  );

  const confirmDeleteConversation = () => {
    const convId = item._id?.toString?.() ?? String(item._id);
    if (isGroupConv) {
      Alert.alert('Leave Group', `Leave "${item.groupName || 'group'}"?`, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.post(`${ENDPOINTS.LEAVE_GROUP}/${item._id}/leave`, {});
              onRemoved(convId);
            } catch (e: any) {
              Alert.alert('Error', e?.message || 'Failed to leave group');
            }
          },
        },
      ]);
      return;
    }
    Alert.alert(deleteTitle, deleteWarning, [
      { text: cancelLabel, style: 'cancel' },
      {
        text: deleteLabel,
        style: 'destructive',
        onPress: async () => {
          try {
            await apiService.delete(`${ENDPOINTS.DELETE_CONVERSATION}/${item._id}`);
            onRemoved(convId);
          } catch (e: any) {
            Alert.alert(errorLabel, e?.message || deleteFailedLabel);
          }
        },
      },
    ]);
  };

  return (
    <TouchableOpacity
      style={[styles.conversationItem, styles.rowLtr, { borderBottomColor: borderColor }]}
      onPress={() => onOpen(item)}
      onLongPress={confirmDeleteConversation}
    >
      <View style={styles.avatarContainer}>
        {isGroupConv ? (
          <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: '#1a4a8a' }]}>
            <Text style={[styles.avatarText, { fontSize: 22 }]}>👥</Text>
          </View>
        ) : (
          <View style={hasStory ? styles.avatarStoryWrap : undefined}>
            {hasStory ? <View style={[styles.storyRing, storyRingStyle]} /> : null}
            <TouchableOpacity
              activeOpacity={0.7}
              onPress={() => {
                const uid = otherUserId?.toString?.() ?? String(otherUserId);
                if (uid) onAvatarPress(uid, otherUserData);
              }}
            >
              {otherUserData?.profilePic ? (
                <Image source={{ uri: otherUserData.profilePic }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: avatarBg }]}>
                  <Text style={styles.avatarText}>
                    {otherUserData?.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        )}
        {isOnline ? (
          <View style={[styles.onlineDot, { backgroundColor: successColor, borderColor: backgroundColor }]} />
        ) : null}
      </View>
      <View style={[styles.conversationInfo, styles.colLtr]}>
        <View style={styles.conversationHeader}>
          <View style={styles.conversationTitleCol}>
            <View style={styles.userNameRow}>
              <Text
                {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
                style={[styles.userName, LTR_TEXT, { color: textColor, flex: 1, minWidth: 0 }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {displayName}
              </Text>
              {isGroupConv ? (
                <Text
                  {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
                  style={{
                    fontSize: 10,
                    color: primaryColor,
                    marginLeft: 4,
                    fontWeight: '600',
                    flexShrink: 0,
                    ...LTR_TEXT,
                  }}
                >
                  GROUP
                </Text>
              ) : null}
            </View>
          </View>
          <View style={styles.rightHeader}>
            {timeLabel ? (
              <Text
                {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
                style={[styles.time, LTR_TEXT, { color: textGray }]}
              >
                {timeLabel}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={confirmDeleteConversation}
              style={styles.deleteBtn}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Text style={styles.deleteIcon}>{isGroupConv ? '🚪' : '🗑️'}</Text>
            </TouchableOpacity>
          </View>
        </View>
        {isGroupConv ? (
          <Text
            {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
            style={[styles.lastMessage, LTR_TEXT, { color: textGray, fontSize: 12, marginBottom: 2 }]}
            numberOfLines={1}
          >
            {item.participants?.length || 0} members
          </Text>
        ) : null}
        <View style={styles.lastMessageRow}>
          <Text
            {...(Platform.OS === 'android' ? { textDirection: 'ltr' as const } : {})}
            style={[
              styles.lastMessage,
              LTR_TEXT,
              { color: textGray },
              unreadCount > 0 && styles.unreadMessage,
              unreadCount > 0 && { color: textColor },
            ]}
            numberOfLines={1}
          >
            {item.lastMessage?.text || noMessagesLabel}
          </Text>
          {unreadCount > 0 ? (
            <View style={[styles.unreadBadge, { backgroundColor: primaryColor }]}>
              <Text style={styles.unreadText}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const areEqual = (prev: Props, next: Props) => {
  const p = prev.item;
  const n = next.item;
  return (
    (p._id?.toString?.() ?? String(p._id)) === (n._id?.toString?.() ?? String(n._id)) &&
    (p.unreadCount || 0) === (n.unreadCount || 0) &&
    p.lastMessage?.text === n.lastMessage?.text &&
    p.lastMessage?.createdAt === n.lastMessage?.createdAt &&
    p.updatedAt === n.updatedAt &&
    p.groupName === n.groupName &&
    (p.participants?.length || 0) === (n.participants?.length || 0) &&
    prev.isOnline === next.isOnline &&
    prev.hasStory === next.hasStory &&
    prev.hasUnviewedStory === next.hasUnviewedStory &&
    prev.borderColor === next.borderColor &&
    prev.textColor === next.textColor
  );
};

export default memo(ConversationListItem, areEqual);

const styles = StyleSheet.create({
  conversationItem: {
    flexDirection: 'row',
    padding: 15,
    borderBottomWidth: 1,
  },
  rowLtr: {
    direction: 'ltr',
  },
  colLtr: {
    direction: 'ltr',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 15,
  },
  avatarStoryWrap: {
    width: LIST_AVATAR + 6,
    height: LIST_AVATAR + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyRing: {
    position: 'absolute',
    width: LIST_AVATAR + 6,
    height: LIST_AVATAR + 6,
    borderRadius: (LIST_AVATAR + 6) / 2,
    borderWidth: 2,
  },
  avatar: {
    width: LIST_AVATAR,
    height: LIST_AVATAR,
    borderRadius: LIST_AVATAR / 2,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  onlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
  },
  userNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  conversationInfo: {
    flex: 1,
  },
  conversationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  conversationTitleCol: {
    flex: 1,
    minWidth: 0,
    marginRight: 8,
  },
  rightHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  deleteBtn: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  deleteIcon: {
    fontSize: 16,
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  time: {
    fontSize: 12,
  },
  lastMessageRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMessage: {
    fontSize: 14,
    flex: 1,
  },
  unreadMessage: {
    fontWeight: 'bold',
  },
  unreadBadge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 6,
    marginLeft: 10,
  },
  unreadText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
