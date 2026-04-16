/**
 * LivePostCard — renders a live stream card inside the mobile feed.
 *
 * Shows: streamer avatar, name, LIVE badge, tap → navigate to LiveViewerScreen.
 */

import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../context/ThemeContext';

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
      style={[styles.card, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
      onPress={goWatch}
      activeOpacity={0.85}
    >
      {/* Preview area */}
      <View style={styles.preview}>
        {streamer.profilePic ? (
          <Image source={{ uri: streamer.profilePic }} style={styles.coverImage} />
        ) : (
          <View style={[styles.coverImage, styles.coverPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={{ color: colors.textGray, fontSize: 32, fontWeight: 'bold' }}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        {/* LIVE overlay */}
        <View style={styles.liveOverlay}>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>🔴 LIVE</Text>
          </View>
        </View>
      </View>

      {/* Footer */}
      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <View style={styles.streamerRow}>
          {streamer.profilePic ? (
            <Image source={{ uri: streamer.profilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
              <Text style={{ color: colors.textGray, fontSize: 14, fontWeight: 'bold' }}>
                {name.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={[styles.streamerName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
            <Text style={[styles.liveNow, { color: '#E53E3E' }]}>Live now</Text>
          </View>
          <TouchableOpacity
            style={[styles.watchBtn, { backgroundColor: '#E53E3E' }]}
            onPress={goWatch}
          >
            <Text style={styles.watchBtnText}>Watch</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card:            { borderRadius: 16, overflow: 'hidden', marginVertical: 8, borderWidth: 1 },
  preview:         { height: 220, position: 'relative' },
  coverImage:      { width: '100%', height: '100%' },
  coverPlaceholder:{ justifyContent: 'center', alignItems: 'center' },
  liveOverlay:     { position: 'absolute', top: 10, left: 10 },
  liveBadge:       { backgroundColor: '#E53E3E', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  liveBadgeText:   { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  footer:          { padding: 12, borderTopWidth: 1 },
  streamerRow:     { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar:          { width: 36, height: 36, borderRadius: 18 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  streamerName:    { fontWeight: 'bold', fontSize: 14 },
  liveNow:         { fontSize: 12, marginTop: 1 },
  watchBtn:        { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 20 },
  watchBtnText:    { color: '#fff', fontWeight: 'bold', fontSize: 13 },
});

export default LivePostCard;
