import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, ScrollView } from 'react-native';
import { COLORS } from '../utils/constants';

type Challenge = {
  from: string;
  fromName?: string;
  fromUsername?: string;
  fromProfilePic?: string;
  timestamp?: number;
};

type Props = {
  challenges: Challenge[];
  onAccept: (challenge: Challenge) => void;
  onDecline: (challenge: Challenge) => void;
};

const ChessChallengeNotification: React.FC<Props> = ({
  challenges,
  onAccept,
  onDecline,
}) => {
  if (!challenges || challenges.length === 0) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>♟️ Chess Challenges</Text>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{challenges.length} pending</Text>
          </View>
        </View>

        <ScrollView style={styles.challengesList} showsVerticalScrollIndicator={false}>
          {challenges.map((challenge) => (
            <View key={challenge.from} style={styles.challengeItem}>
              <View style={styles.challengeRow}>
                {challenge.fromProfilePic ? (
                  <Image source={{ uri: challenge.fromProfilePic }} style={styles.avatar} />
                ) : (
                  <View style={[styles.avatar, styles.avatarPlaceholder]}>
                    <Text style={styles.avatarText}>
                      {(challenge.fromName || challenge.fromUsername || '?')?.[0]?.toUpperCase() || '?'}
                    </Text>
                  </View>
                )}
                <View style={styles.info}>
                  <Text style={styles.challengeName} numberOfLines={1}>
                    {challenge.fromName || 'Unknown'}
                  </Text>
                  <Text style={styles.challengeUsername} numberOfLines={1}>
                    @{challenge.fromUsername || 'unknown'}
                  </Text>
                  <Text style={styles.challengeText}>
                    ♟️ Challenges you to Chess!
                  </Text>
                </View>
              </View>

              <View style={styles.actions}>
                <TouchableOpacity 
                  style={[styles.button, styles.accept]} 
                  onPress={() => onAccept(challenge)}
                >
                  <Text style={styles.buttonText}>Accept</Text>
                </TouchableOpacity>
                <View style={{ width: 10 }} />
                <TouchableOpacity 
                  style={[styles.button, styles.decline]} 
                  onPress={() => onDecline(challenge)}
                >
                  <Text style={styles.buttonText}>Decline</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 70,
    right: 14,
    left: 14,
    zIndex: 9999,
    maxHeight: 400,
  },
  card: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    maxHeight: 400,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerTitle: {
    color: COLORS.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  badge: {
    backgroundColor: '#9333EA', // purple
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
  challengesList: {
    maxHeight: 300,
  },
  challengeItem: {
    backgroundColor: 'rgba(147, 51, 234, 0.1)', // purple.50 equivalent
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(147, 51, 234, 0.3)', // purple.200 equivalent
    padding: 12,
    marginBottom: 10,
  },
  challengeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    marginRight: 12,
  },
  avatarPlaceholder: {
    backgroundColor: COLORS.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  info: {
    flex: 1,
    minWidth: 0,
  },
  challengeName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  challengeUsername: {
    color: COLORS.textGray,
    fontSize: 12,
    marginBottom: 4,
  },
  challengeText: {
    color: '#9333EA', // purple.500
    fontSize: 12,
    fontWeight: '500',
  },
  actions: {
    flexDirection: 'row',
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accept: {
    backgroundColor: COLORS.success,
  },
  decline: {
    backgroundColor: COLORS.error,
  },
  buttonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
});

export default ChessChallengeNotification;

