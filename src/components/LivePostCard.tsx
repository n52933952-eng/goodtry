/**
 * LivePostCard — renders a live stream card inside the mobile feed.
 *
 * Shows: streamer avatar, name, LIVE badge, tap → navigate to LiveViewerScreen.
 */

import React, { useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';
import { useFeedCardMetrics } from '../utils/feedCardLayout';
import { s } from '../utils/liveScreenLayout';

interface LivePostCardProps {
  post: {
    _id: string;
    roomName: string;
    postedBy: {
      _id: string;
      name?: string;
      username?: string;
      profilePic?: string;
    };
  };
}

const LivePostCard: React.FC<LivePostCardProps> = ({ post }) => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const fc = useFeedCardMetrics();

  const ui = useMemo(
    () => ({
      card: {
        borderRadius: fc.cardRadius,
        marginVertical: fc.cardMarginV,
      },
      preview: { height: fc.mediaHeight },
      liveOverlay: { top: fc.liveOverlayTop, left: fc.liveOverlayLeft },
      liveBadge: {
        borderRadius: s(6, fc.scale),
        paddingHorizontal: s(10, fc.scale),
        paddingVertical: s(4, fc.scale),
      },
      liveBadgeText: { fontSize: fc.liveBadgeSize },
      footer: { padding: fc.cardPadding },
      streamerRow: { gap: s(10, fc.scale) },
      avatar: {
        width: fc.liveAvatar,
        height: fc.liveAvatar,
        borderRadius: fc.liveAvatar / 2,
      },
      streamerName: { fontSize: fc.liveNameSize },
      liveNow: { fontSize: fc.liveSubSize, marginTop: s(1, fc.scale) },
      watchBtn: {
        paddingVertical: fc.watchBtnPadV,
        paddingHorizontal: fc.watchBtnPadH,
        borderRadius: s(20, fc.scale),
      },
      watchBtnText: { fontSize: fc.watchBtnTextSize },
      placeholderLetter: { fontSize: fc.livePlaceholderSize },
      avatarLetter: { fontSize: s(14, fc.scale) },
    }),
    [fc],
  );

  const streamer   = post.postedBy;
  const streamerId = String(streamer._id);
  const name       = streamer.name || streamer.username || 'User';

  const goWatch = () => {
    navigation.navigate('LiveViewer', {
      streamerId,
      streamerName:       name,
      streamerProfilePic: streamer.profilePic,
      roomName:           post.roomName,
    });
  };

  return (
    <TouchableOpacity
      style={[styles.card, ui.card, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
      onPress={goWatch}
      activeOpacity={0.85}
    >
      <View style={[styles.preview, ui.preview]}>
        {streamer.profilePic ? (
          <Image source={{ uri: streamer.profilePic }} style={styles.coverImage} resizeMode="cover" />
        ) : (
          <View style={[styles.coverImage, styles.coverPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[{ color: colors.textGray, fontWeight: 'bold' }, ui.placeholderLetter]}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={[styles.liveOverlay, ui.liveOverlay]}>
          <View style={[styles.liveBadge, ui.liveBadge]}>
            <Text style={[styles.liveBadgeText, ui.liveBadgeText]}>🔴 LIVE</Text>
          </View>
        </View>
      </View>

      <View style={[styles.footer, ui.footer, { borderTopColor: colors.border }]}>
        <View style={[styles.streamerRow, ui.streamerRow]}>
          {streamer.profilePic ? (
            <Image source={{ uri: streamer.profilePic }} style={[styles.avatar, ui.avatar]} />
          ) : (
            <View style={[styles.avatar, ui.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={[{ color: colors.textGray, fontWeight: 'bold' }, ui.avatarLetter]}>
                {name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.streamerName, ui.streamerName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            <Text style={[styles.liveNow, ui.liveNow, { color: '#E53E3E' }]}>Live now</Text>
          </View>
          <TouchableOpacity
            style={[styles.watchBtn, ui.watchBtn, { backgroundColor: '#E53E3E' }]}
            onPress={goWatch}
          >
            <Text style={[styles.watchBtnText, ui.watchBtnText]}>Watch</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card:            { overflow: 'hidden', borderWidth: 1 },
  preview:         { position: 'relative' },
  coverImage:      { width: '100%', height: '100%' },
  coverPlaceholder:{ justifyContent: 'center', alignItems: 'center' },
  liveOverlay:     { position: 'absolute' },
  liveBadge:       { backgroundColor: '#E53E3E' },
  liveBadgeText:   { color: '#fff', fontWeight: 'bold' },
  footer:          { borderTopWidth: 1 },
  streamerRow:     { flexDirection: 'row', alignItems: 'center' },
  avatar:          {},
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  streamerName:    { fontWeight: 'bold' },
  liveNow:         {},
  watchBtn:        {},
  watchBtnText:    { color: '#fff', fontWeight: 'bold' },
});

export default LivePostCard;
