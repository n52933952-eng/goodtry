/**
 * Host face preview while live + screen sharing on feed / chess (not on live controls screen).
 */

import React, { useSyncExternalStore } from 'react';
import { useLiveBroadcast } from '../context/LiveBroadcastContext';
import { liveBroadcastNav } from '../services/liveBroadcastNav';
import HostCameraPipHost from './HostCameraPipHost';

const LiveCameraPip = () => {
  const { isLive, isSharing, localTrack } = useLiveBroadcast();

  const onLiveBroadcastScreen = useSyncExternalStore(
    (cb) => liveBroadcastNav.subscribeRoute(cb),
    () => liveBroadcastNav.isOnLiveBroadcast,
    () => false,
  );

  const active = isLive && isSharing && !!localTrack && !onLiveBroadcastScreen;

  if (!active || !localTrack) return null;

  return <HostCameraPipHost track={localTrack} active />;
};

export default LiveCameraPip;
