/**
 * GroupCallScreen — WhatsApp-style group call UI for mobile.
 *
 * Renders:
 *  1. Incoming group call ring (Answer / Decline)
 *  2. Active call grid — one tile per participant
 *  3. Mute, Camera, End controls
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VideoView } from '@livekit/react-native';
import { Track } from 'livekit-client';
import { useNavigation } from '@react-navigation/native';
import { useGroupCall } from '../../context/GroupCallContext';
import { useTheme } from '../../context/ThemeContext';
import { useUser } from '../../context/UserContext';

// ── Single participant tile ───────────────────────────────────────────────────
const ParticipantTile = ({ participant, size }: { participant: any; size: number }) => {
  const camPub = participant.getTrackPublication?.(Track.Source.Camera);
  const videoTrack = camPub?.track;

  return (
    <View style={[styles.tile, { width: size, height: size * 1.2 }]}>
      {videoTrack ? (
        <VideoView videoTrack={videoTrack} style={StyleSheet.absoluteFill} objectFit="cover" />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.avatarTile]}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>
              {(participant.name || participant.identity || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        </View>
      )}
      <View style={styles.namePill}>
        <Text style={styles.nameText} numberOfLines={1}>
          {participant.name || participant.identity}
        </Text>
      </View>
    </View>
  );
};

// ── Local participant tile ────────────────────────────────────────────────────
const LocalTile = ({ room, size, userName }: { room: any; size: number; userName: string }) => {
  if (!room) return null;
  const camPub = room.localParticipant?.getTrackPublication?.(Track.Source.Camera);
  const videoTrack = camPub?.track;

  return (
    <View style={[styles.tile, { width: size, height: size * 1.2 }]}>
      {videoTrack ? (
        <VideoView videoTrack={videoTrack} style={StyleSheet.absoluteFill} objectFit="cover" mirror />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.avatarTile]}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarInitial}>{(userName || 'Y').charAt(0).toUpperCase()}</Text>
          </View>
        </View>
      )}
      <View style={styles.namePill}>
        <Text style={styles.nameText} numberOfLines={1}>You</Text>
      </View>
    </View>
  );
};

// ── Main screen ───────────────────────────────────────────────────────────────
const GroupCallScreen = () => {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const { user }   = useUser();
  const insets = useSafeAreaInsets();

  const {
    incomingGroupCall,
    groupCallActive,
    groupCallType,
    participants,
    room,
    joinGroupCall,
    declineGroupCall,
    leaveGroupCall,
  } = useGroupCall();

  const [isMuted,  setIsMuted]  = useState(false);
  const [isCamOff, setIsCamOff] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  const handleMute = useCallback(async () => {
    if (!room) return;
    const next = !isMuted;
    await room.localParticipant.setMicrophoneEnabled(!next);
    setIsMuted(next);
  }, [room, isMuted]);

  const handleCam = useCallback(async () => {
    if (!room) return;
    const next = !isCamOff;
    await room.localParticipant.setCameraEnabled(!next);
    setIsCamOff(next);
  }, [room, isCamOff]);

  const handleLeave = useCallback(() => {
    leaveGroupCall();
    if (navigation.canGoBack()) navigation.goBack();
  }, [leaveGroupCall, navigation]);

  const handleJoin = useCallback(async () => {
    if (isJoining) return;
    setIsJoining(true);
    try {
      await joinGroupCall();
    } finally {
      setIsJoining(false);
    }
    // GroupCallContext sets groupCallActive; this screen reuses itself for active state
  }, [joinGroupCall, isJoining]);

  // ── Incoming ring UI ──────────────────────────────────────────────────────
  if (incomingGroupCall && !groupCallActive) {
    const isAudio = incomingGroupCall.callType === 'audio';
    return (
      <View style={[styles.incomingRoot, { backgroundColor: colors.background }]}>
        <ScrollView
          contentContainerStyle={[
            styles.incomingScrollContent,
            { paddingTop: Math.max(insets.top, 12) + 8, paddingBottom: 8 },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          <View style={styles.incomingCenter}>
            {incomingGroupCall.callerProfilePic ? (
              <Image source={{ uri: incomingGroupCall.callerProfilePic }} style={styles.incomingAvatar} />
            ) : (
              <View
                style={[
                  styles.incomingAvatar,
                  styles.avatarPlaceholder,
                  { backgroundColor: colors.avatarBg },
                ]}
              >
                <Text style={[styles.incomingInitial, { color: '#fff' }]}>
                  {(incomingGroupCall.callerName || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
            )}

            <View style={[styles.incomingBadgeRow, { borderColor: colors.border }]}>
              <Text style={[styles.incomingBadgeLabel, { color: colors.primary }]}>GROUP CALL</Text>
              <View
                style={[
                  styles.incomingTypePill,
                  { backgroundColor: colors.backgroundLight, borderColor: colors.border },
                ]}
              >
                <Text style={[styles.incomingTypeText, { color: colors.text }]}>
                  {isAudio ? 'Voice' : 'Video'}
                </Text>
              </View>
            </View>

            <Text
              style={[styles.incomingCallerName, { color: colors.text }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {incomingGroupCall.callerName || 'Group call'}
            </Text>
            <Text style={[styles.incomingHint, { color: colors.textGray, textAlign: 'center' }]}>
              {isAudio ? 'Voice call' : 'Video call'}
            </Text>
          </View>
        </ScrollView>

        <View
          style={[
            styles.incomingActions,
            {
              paddingBottom: Math.max(insets.bottom, 12) + 8,
              paddingHorizontal: 20,
              borderTopColor: colors.border,
              backgroundColor: colors.background,
            },
          ]}
        >
          <TouchableOpacity
            style={[styles.incomingActionBtn, { backgroundColor: colors.error }]}
            onPress={() => {
              declineGroupCall();
              if (navigation.canGoBack()) navigation.goBack();
            }}
            activeOpacity={0.85}
          >
            <Text style={styles.actionBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.incomingActionBtn,
              { backgroundColor: colors.success, opacity: isJoining ? 0.85 : 1 },
            ]}
            onPress={handleJoin}
            disabled={isJoining}
            activeOpacity={0.85}
          >
            {isJoining ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.actionBtnText}>Join</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Active call UI ────────────────────────────────────────────────────────
  const allTiles = [{ id: 'local', isLocal: true }, ...participants.map(p => ({ id: p.identity, isLocal: false, participant: p }))];
  const tileSize = allTiles.length <= 2 ? 160 : allTiles.length <= 4 ? 140 : 110;
  const numCols  = allTiles.length <= 1 ? 1 : 2;

  return (
    <View style={[styles.container, { backgroundColor: '#111' }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Group Call</Text>
        <Text style={styles.headerSub}>
          {allTiles.length === 1 ? '1 participant' : `${allTiles.length} participants`}
        </Text>
      </View>

      {/* Grid */}
      <FlatList
        data={allTiles}
        keyExtractor={item => item.id}
        numColumns={numCols}
        key={numCols}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) =>
          item.isLocal
            ? <LocalTile room={room} size={tileSize} userName={user?.name || user?.username || 'You'} />
            : <ParticipantTile participant={item.participant} size={tileSize} />
        }
      />

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.ctrlBtn, { backgroundColor: isMuted ? colors.error : 'rgba(255,255,255,0.15)' }]}
          onPress={handleMute}
        >
          <Text style={styles.ctrlText}>{isMuted ? '🔇' : '🎙️'}</Text>
          <Text style={styles.ctrlLabel}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        {groupCallType !== 'audio' && (
          <TouchableOpacity
            style={[styles.ctrlBtn, { backgroundColor: isCamOff ? colors.error : 'rgba(255,255,255,0.15)' }]}
            onPress={handleCam}
          >
            <Text style={styles.ctrlText}>{isCamOff ? '📷' : '📹'}</Text>
            <Text style={styles.ctrlLabel}>{isCamOff ? 'Cam On' : 'Cam Off'}</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={[styles.ctrlBtn, { backgroundColor: colors.error }]} onPress={handleLeave}>
          <Text style={styles.ctrlText}>📵</Text>
          <Text style={styles.ctrlLabel}>Leave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container:       { flex: 1 },
  incomingRoot:    { flex: 1 },
  incomingScrollContent: { flexGrow: 1, justifyContent: 'center' },
  incomingCenter: {
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  incomingAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    marginBottom: 20,
  },
  incomingInitial: { fontSize: 44, fontWeight: '700' },
  incomingBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 14,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  incomingBadgeLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  incomingTypePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  incomingTypeText: { fontSize: 13, fontWeight: '700' },
  incomingCallerName: {
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
    maxWidth: '100%',
    width: '100%',
    textAlign: 'center',
    marginBottom: 6,
  },
  incomingHint: {
    fontSize: 15,
    fontWeight: '500',
    opacity: 0.95,
    maxWidth: '100%',
  },
  incomingActions: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  incomingActionBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 12,
  },
  header:          { paddingTop: 52, paddingHorizontal: 16, paddingBottom: 8, backgroundColor: 'rgba(0,0,0,0.4)' },
  headerTitle:     { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  headerSub:       { color: '#aaa', fontSize: 13, marginTop: 2 },
  grid:            { padding: 8, flexGrow: 1, justifyContent: 'center' },
  tile:            { margin: 4, borderRadius: 12, overflow: 'hidden', backgroundColor: '#222' },
  avatarTile:      { justifyContent: 'center', alignItems: 'center' },
  avatarCircle:    { width: 72, height: 72, borderRadius: 36, backgroundColor: '#444', justifyContent: 'center', alignItems: 'center' },
  avatarInitial:   { color: '#fff', fontSize: 28, fontWeight: 'bold' },
  namePill:        { position: 'absolute', bottom: 6, left: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  nameText:        { color: '#fff', fontSize: 11, textAlign: 'center' },
  controls:        { flexDirection: 'row', justifyContent: 'center', gap: 16, paddingVertical: 20, backgroundColor: 'rgba(0,0,0,0.6)' },
  ctrlBtn:         { alignItems: 'center', padding: 12, borderRadius: 16, minWidth: 72 },
  ctrlText:        { fontSize: 24 },
  ctrlLabel:       { color: '#fff', fontSize: 11, marginTop: 4 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  actionBtnText:   { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

export default GroupCallScreen;
