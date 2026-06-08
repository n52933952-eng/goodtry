/** Navigation hooks filled by AppNavigator when the container is ready. */

type RouteListener = () => void;

const routeListeners = new Set<RouteListener>();

function notifyRouteListeners() {
  routeListeners.forEach((l) => l());
}

export const callSessionNav = {
  minimizeToAppHome: null as (() => void) | null,
  returnToOneToOne: null as (() => void) | null,
  returnToGroup: null as (() => void) | null,

  isOnCallScreen: false,
  isOnGroupCallScreen: false,
  /** True while ringing, connecting, or in an active 1:1 call (any screen). */
  isInOneToOneCallSession: false,

  setOneToOneCallSessionActive(active: boolean) {
    if (callSessionNav.isInOneToOneCallSession === active) return;
    callSessionNav.isInOneToOneCallSession = active;
    notifyRouteListeners();
  },

  setRootRouteName(name: string | undefined | null) {
    const onCall = name === 'CallScreen';
    const onGroup = name === 'GroupCallScreen';
    if (callSessionNav.isOnCallScreen === onCall && callSessionNav.isOnGroupCallScreen === onGroup) {
      return;
    }
    callSessionNav.isOnCallScreen = onCall;
    callSessionNav.isOnGroupCallScreen = onGroup;
    notifyRouteListeners();
  },

  subscribeRoute(listener: RouteListener) {
    routeListeners.add(listener);
    return () => {
      routeListeners.delete(listener);
    };
  },
};
