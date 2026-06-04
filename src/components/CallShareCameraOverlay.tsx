/**
 * Camera previews while 1:1 call + screen share and user left CallScreen (feed / app home).
 * Android often stops the in-call UI VideoViews when the screen unmounts — this stays mounted at root.
 */

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { VideoView } from '@livekit/react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useWebRTC } from '../context/LiveKitContext';
import { callSessionNav } from '../services/callSessionNav';

const BOX_H = 108;

const CallShareCameraOverlay = () => {
  const insets = useSafeAreaInsets();
  const {
    callAccepted, isScreenSharing, localVideoTrack, remoteVideoTrack,
    refreshCallTracks, call,
  } = useWebRTC();

  const onCallScreen = useSyncExternalStore(
    (cb) => callSessionNav.subscribeRoute(cb),
    () => callSessionNav.isOnCallScreen,
    () => false,
  );

  const visible = callAccepted && isScreenSharing && !onCallScreen;
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    if (!visible) return undefined;
    // Make sure camera stays on while on the feed
    void refreshCallTracks();
    const t = setTimeout(() => setRenderKey((k) => k + 1), 400);
    return () => clearTimeout(t);
  }, [visible, refreshCallTracks]);

  if (!visible) return null;

  const tabBar = 60 + Math.max(insets.bottom, 0);
  const miniBar = 56;
  const bottom = tabBar + miniBar + 10;

  const callerName = call.name || 'Caller';
  const localName = 'You';

  return (
    <View style={[styles.wrap, { bottom }]} pointerEvents="none">
      <View style={styles.row}>
        <View style={styles.box}>
          {remoteVideoTrack ? (
            <VideoView
              key={`ovl-r-${remoteVideoTrack.sid ?? 'r'}-${renderKey}`}
              videoTrack={remoteVideoTrack}
              style={styles.video}
              objectFit="cover"
              zOrder={2}
            />
          ) : (
            <View style={styles.placeholder}>
              <ActivityIndicator color="#fff" size="small" />
            </View>
          )}
          <Text style={styles.label} numberOfLines={1}>{callerName}</Text>
        </View>
        <View style={styles.box}>
          {localVideoTrack ? (
            <VideoView
              key={`ovl-l-${localVideoTrack.sid ?? 'l'}-${renderKey}`}
              videoTrack={localVideoTrack}
              style={styles.video}
              objectFit="cover"
              mirror
              zOrder={2}
            />
          ) : (
            <View style={styles.placeholder}>
              <ActivityIndicator color="#fff" size="small" />
            </View>
          )}
          <Text style={styles.label} numberOfLines={1}>{localName}</Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9996,
    elevation: 11,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  box: {
    flex: 1,
    height: BOX_H,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  video: { width: '100%', height: '100%' },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    textAlign: 'center',
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 4,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});

export default CallShareCameraOverlay;
