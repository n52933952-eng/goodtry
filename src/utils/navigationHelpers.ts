import { CommonActions } from '@react-navigation/native';

/**
 * Navigate to a screen registered on the root stack (e.g. StoryViewer, CreatePost)
 * from nested stacks (FeedStack, ProfileStack).
 */
export function navigateToMainStack(navigation: { getParent?: () => any }, routeName: string, params?: object) {
  const tab = navigation.getParent?.();
  const main = tab?.getParent?.();
  if (main?.navigate) {
    main.navigate(routeName as never, params as never);
  } else {
    navigation.navigate?.(routeName as never, params as never);
  }
}

type NavNode = {
  getParent?: () => NavNode | undefined;
  dispatch?: (action: unknown) => void;
  navigate?: (name: string, params?: object) => void;
  canGoBack?: () => boolean;
  goBack?: () => void;
};

function findNavWithDispatch(navigation: NavNode | undefined | null): NavNode | null {
  let cur: NavNode | undefined | null = navigation;
  const seen = new Set<NavNode>();
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    if (typeof cur.dispatch === 'function') return cur;
    cur = cur.getParent?.();
  }
  return null;
}

/** Home feed (Feed tab) — same target as the live "browse app" minimize button. */
export function navigateToHomeFeed(navigation: NavNode) {
  const resetAction = CommonActions.reset({
    index: 0,
    routes: [
      {
        name: 'MainTabs',
        params: {
          screen: 'Feed',
          params: { screen: 'FeedScreen' },
        },
      },
    ],
  });

  // Walk parents until we find a real dispatcher. Preferring getParent()?.getParent()
  // alone can hit a container object without `dispatch` and silently no-op (Cancel stuck).
  const withDispatch = findNavWithDispatch(navigation);
  if (withDispatch?.dispatch) {
    withDispatch.dispatch(resetAction);
    return;
  }

  if (typeof navigation.navigate === 'function') {
    navigation.navigate('MainTabs', {
      screen: 'Feed',
      params: { screen: 'FeedScreen' },
    });
    return;
  }

  if (navigation.canGoBack?.()) {
    navigation.goBack?.();
    return;
  }

  console.warn('[navigateToHomeFeed] no navigator available');
}
