/** Navigation hooks filled by AppNavigator when the container is ready. */

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
