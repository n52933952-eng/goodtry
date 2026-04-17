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
  View, Text, TouchableOpacity, StyleSheet, FlatList, Image, ActivityIndicator,
} from 'react-native';
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
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        {incomingGroupCall.callerProfilePic ? (
          <Image source={{ uri: incomingGroupCall.callerProfilePic }} style={styles.bigAvatar} />
        ) : (
          <View style={[styles.bigAvatar, styles.avatarPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={[styles.bigInitial, { color: colors.textGray }]}>
              {(incomingGroupCall.callerName || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <Text style={[styles.callTitle, { color: colors.textGray }]}>Group Call</Text>
        <Text style={[styles.callerName, { color: colors.text }]}>{incomingGroupCall.callerName}</Text>
        <Text style={[styles.callSub, { color: colors.textGray }]}>
          {incomingGroupCall.callType === 'audio' ? 'Voice call' : 'Video call'}
        </Text>
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.error }]}
            onPress={() => { declineGroupCall(); if (navigation.canGoBack()) navigation.goBack(); }}
          >
            <Text style={styles.actionBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: colors.success, opacity: isJoining ? 0.85 : 1 }]}
            onPress={handleJoin}
            disabled={isJoining}
          >
            {isJoining ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionBtnText}>Join</Text>}
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
        <Text style={styles.headerSub}>{allTiles.length} participants</Text>
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
  // incoming ring
  bigAvatar:       { width: 100, height: 100, borderRadius: 50, marginBottom: 16 },
  avatarPlaceholder: { justifyContent: 'center', alignItems: 'center' },
  bigInitial:      { fontSize: 36, fontWeight: 'bold' },
  callTitle:       { fontSize: 14, marginBottom: 4 },
  callerName:      { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  callSub:         { fontSize: 15, marginBottom: 32 },
  actionRow:       { flexDirection: 'row', gap: 24 },
  actionBtn:       { paddingVertical: 14, paddingHorizontal: 28, borderRadius: 12 },
  actionBtnText:   { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

export default GroupCallScreen;
