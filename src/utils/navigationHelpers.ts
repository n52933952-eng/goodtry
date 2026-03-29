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
