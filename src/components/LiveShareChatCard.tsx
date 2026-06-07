/**
 * Compact live card inside chat bubbles — avatar, name, "tap to watch".
 */

import React from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { LiveSharePayload } from '../utils/liveShareMessage';

type Props = {
  live: LiveSharePayload;
  onPress: () => void;
  textColor: string;
  subColor: string;
  borderColor: string;
  backgroundColor: string;
};

const LiveShareChatCard: React.FC<Props> = ({
  live,
  onPress,
  textColor,
  subColor,
  borderColor,
  backgroundColor,
}) => {
  const name = live.streamerName || 'User';

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.card, { borderColor, backgroundColor }]}
    >
      <View style={styles.row}>
        {live.streamerProfilePic ? (
          <Image source={{ uri: live.streamerProfilePic }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarPlaceholder]}>
            <Text style={styles.avatarLetter}>{name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={styles.body}>
          <View style={styles.liveBadge}>
            <Text style={styles.liveBadgeText}>🔴 LIVE</Text>
          </View>
          <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.hint, { color: subColor }]}>Tap to watch</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    width: 240,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    width: '100%',
  },
  avatar: { width: 40, height: 40, borderRadius: 20, flexShrink: 0 },
  avatarPlaceholder: {
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarLetter: { fontWeight: '700', color: '#555' },
  body: { flex: 1, minWidth: 0 },
  liveBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#E53E3E',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    marginBottom: 3,
  },
  liveBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  name: { fontSize: 14, fontWeight: '700' },
  hint: { fontSize: 12, marginTop: 2 },
});

export default LiveShareChatCard;
