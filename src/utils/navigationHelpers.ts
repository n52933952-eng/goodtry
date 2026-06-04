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

/** Home feed (Feed tab) — same target as the live "browse app" minimize button. */
export function navigateToHomeFeed(navigation: { getParent?: () => any; dispatch?: (action: unknown) => void }) {
  const tab = navigation.getParent?.();
  const root = (tab?.getParent?.() ?? tab ?? navigation) as {
    dispatch?: (action: unknown) => void;
    navigate?: (name: string, params?: object) => void;
  };
  if (!root?.dispatch) return;

  root.dispatch(
    CommonActions.reset({
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
    }),
  );
}
