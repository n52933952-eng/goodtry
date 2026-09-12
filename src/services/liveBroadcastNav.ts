/** Navigation hooks filled by AppNavigator when the container is ready. */

import { Platform } from 'react-native';

type RouteListener = () => void;
type UiBlockListener = () => void;

const routeListeners = new Set<RouteListener>();
const uiBlockListeners = new Set<UiBlockListener>();

function notifyRouteListeners() {
  routeListeners.forEach((l) => l());
}

function notifyUiBlockListeners() {
  uiBlockListeners.forEach((l) => l());
}

function setFloatingTouchesBlocked(blocked: boolean) {
  if (liveBroadcastNav.blockFloatingTouches === blocked) return;
  liveBroadcastNav.blockFloatingTouches = blocked;
  liveBroadcastNav.blockMiniBarTouches = blocked;
  liveBroadcastNav.blockHostPipTouches = blocked;
  notifyUiBlockListeners();
}

export const liveBroadcastNav = {
  minimize: null as (() => void) | null,
  returnToLive: null as (() => void) | null,
  goToProfile: null as (() => void) | null,
  /** Stop live (viewers ended) without navigating away — used before answering a call. */
  endForCall: null as (() => Promise<void>) | null,

  /** While true, game screens must not auto-navigate on cardGameCleanup / similar. */
  suppressGameCleanupNav: false,

  /**
   * Host is in an active LiveKit broadcast (camera/mic published).
   * Keep the app socket up (like calls) so a brief flap does not erase the feed live card.
   */
  isLiveSessionActive: false,

  /** Game Over — LIVE mini bar + host camera pip must not steal taps. */
  blockFloatingTouches: false,
  /** @deprecated use blockFloatingTouches */
  blockMiniBarTouches: false,
  blockHostPipTouches: false,

  setFloatingTouchesBlocked,

  isOnLiveBroadcast: false,

  setRootRouteName(name: string | undefined | null) {
    const onLive = name === 'LiveBroadcast';
    if (liveBroadcastNav.isOnLiveBroadcast === onLive) return;
    liveBroadcastNav.isOnLiveBroadcast = onLive;
    notifyRouteListeners();
  },

  subscribeRoute(listener: RouteListener) {
    routeListeners.add(listener);
    return () => {
      routeListeners.delete(listener);
    };
  },

  subscribeUiBlock(listener: UiBlockListener) {
    uiBlockListeners.add(listener);
    return () => {
      uiBlockListeners.delete(listener);
    };
  },
};

/**
 * End an active broadcast before joining a call room (1:1 or group, incoming or outgoing).
 * Overlapping LiveKit rooms fail Android WebRTC negotiation, so the live camera/mic must be
 * released first. No-op when not live. Covers share + minimize too — a call always wins.
 */
export async function releaseLiveForCall(): Promise<void> {
  if (!liveBroadcastNav.endForCall) return;
  const wasLive = liveBroadcastNav.isLiveSessionActive;
  try {
    await liveBroadcastNav.endForCall();
  } catch (e) {
    console.warn('[liveBroadcastNav] releaseLiveForCall failed', e);
  }
  if (wasLive) {
    // room.disconnect() can resolve before the native camera/PeerConnection is free.
    await new Promise<void>((r) => setTimeout(r, Platform.OS === 'android' ? 350 : 150));
  }
}
