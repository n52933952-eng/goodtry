import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
} from 'react';
import { Animated, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

type TabBarCollapseContextValue = {
  tabBarHeight: number;
  tabBarTranslateY: Animated.Value;
  tabBarTranslateStyle: { transform: [{ translateY: Animated.Value }] };
  onTabBarScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  mergeTabBarScroll: (
    ...handlers: Array<(e: NativeSyntheticEvent<NativeScrollEvent>) => void>
  ) => (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
  resetTabBar: () => void;
  registerCollapsibleScreen: (screenId: string) => void;
  unregisterCollapsibleScreen: (screenId: string) => void;
};

const TabBarCollapseContext = createContext<TabBarCollapseContextValue | null>(null);

type ProviderProps = {
  children: React.ReactNode;
  tabBarHeight: number;
};

export function TabBarCollapseProvider({ children, tabBarHeight }: ProviderProps) {
  const translateY = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const lastScrollYRef = useRef(0);
  const activeScreensRef = useRef(new Set<string>());
  const collapseDistance = tabBarHeight;

  const syncCollapsible = useCallback(() => {
    return activeScreensRef.current.size > 0;
  }, []);

  const resetTabBar = useCallback(() => {
    offsetRef.current = 0;
    lastScrollYRef.current = 0;
    translateY.setValue(0);
  }, [translateY]);

  const registerCollapsibleScreen = useCallback(
    (screenId: string) => {
      activeScreensRef.current.add(screenId);
    },
    [],
  );

  const unregisterCollapsibleScreen = useCallback(
    (screenId: string) => {
      activeScreensRef.current.delete(screenId);
      if (!syncCollapsible()) resetTabBar();
    },
    [resetTabBar, syncCollapsible],
  );

  const isCollapsible = useCallback(() => activeScreensRef.current.size > 0, []);

  const onTabBarScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!isCollapsible()) return;

      const y = Math.max(0, e.nativeEvent.contentOffset.y);
      const dy = y - lastScrollYRef.current;
      lastScrollYRef.current = y;

      if (y <= 4) {
        if (offsetRef.current !== 0) {
          offsetRef.current = 0;
          translateY.setValue(0);
        }
        return;
      }

      let next = offsetRef.current + dy;
      next = Math.max(0, Math.min(collapseDistance, next));
      if (next !== offsetRef.current) {
        offsetRef.current = next;
        translateY.setValue(next);
      }
    },
    [collapseDistance, isCollapsible, translateY],
  );

  const mergeTabBarScroll = useCallback(
    (...handlers: Array<(e: NativeSyntheticEvent<NativeScrollEvent>) => void>) =>
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        onTabBarScroll(e);
        handlers.forEach((handler) => handler?.(e));
      },
    [onTabBarScroll],
  );

  const value = useMemo(
    () => ({
      tabBarHeight,
      tabBarTranslateY: translateY,
      tabBarTranslateStyle: { transform: [{ translateY }] },
      onTabBarScroll,
      mergeTabBarScroll,
      resetTabBar,
      registerCollapsibleScreen,
      unregisterCollapsibleScreen,
    }),
    [
      tabBarHeight,
      translateY,
      onTabBarScroll,
      mergeTabBarScroll,
      resetTabBar,
      registerCollapsibleScreen,
      unregisterCollapsibleScreen,
    ],
  );

  return (
    <TabBarCollapseContext.Provider value={value}>{children}</TabBarCollapseContext.Provider>
  );
}

export function useTabBarCollapse() {
  const ctx = useContext(TabBarCollapseContext);
  if (!ctx) {
    throw new Error('useTabBarCollapse must be used within TabBarCollapseProvider');
  }
  return ctx;
}

/** Enable tab-bar hide/show while this screen is focused (Feed, User Profile). */
export function useTabBarCollapseOnFocus(screenId: string, enabled = true) {
  const {
    registerCollapsibleScreen,
    unregisterCollapsibleScreen,
    resetTabBar,
    mergeTabBarScroll,
    tabBarHeight,
  } = useTabBarCollapse();

  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      registerCollapsibleScreen(screenId);
      return () => {
        unregisterCollapsibleScreen(screenId);
      };
    }, [
      enabled,
      screenId,
      registerCollapsibleScreen,
      unregisterCollapsibleScreen,
    ]),
  );

  return { mergeTabBarScroll, resetTabBar, tabBarHeight };
}

/** Walk navigators until the bottom-tab state is found. */
export function isProfileBottomTab(navigation: any): boolean {
  let nav = navigation?.getParent?.();
  while (nav) {
    const state = nav.getState?.();
    if (state?.type === 'tab') {
      const activeTab = state.routes[state.index ?? 0]?.name;
      return activeTab === 'Profile';
    }
    nav = nav.getParent?.();
  }
  return false;
}
