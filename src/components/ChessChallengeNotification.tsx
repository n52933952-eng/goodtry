import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { COLORS } from '../utils/constants';

type Props = {
  visible: boolean;
  challengerName?: string;
  challengerUsername?: string;
  challengerProfilePic?: string;
  onAccept: () => void;
  onDecline: () => void;
};

const ChessChallengeNotification: React.FC<Props> = ({
  visible,
  challengerName,
  challengerUsername,
  challengerProfilePic,
  onAccept,
  onDecline,
}) => {
  if (!visible) return null;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.card}>
        <View style={styles.row}>
          {challengerProfilePic ? (
            <Image source={{ uri: challengerProfilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {(challengerName || challengerUsername || '?')?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={1}>
              {challengerName || 'Unknown'}
            </Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              ♟️ Chess challenge {challengerUsername ? `@${challengerUsername}` : ''}
            </Text>
          </View>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={[styles.button, styles.accept]} onPress={onAccept}>
            <Text style={styles.buttonText}>Accept</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.button, styles.decline]} onPress={onDecline}>
            <Text style={styles.buttonText}>Decline</Text>
          </TouchableOpacity>
        </View>
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
  },
  card: {
    backgroundColor: COLORS.backgroundLight,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
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
  title: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  subtitle: {
    color: COLORS.textGray,
    fontSize: 13,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
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
  },
});

export default ChessChallengeNotification;

