import { useCallback, useRef, useState } from 'react';
import { Animated, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const STACK_BAR_HEIGHT = 56;

type Options = {
  /** How far the header slides up (px). Defaults to measured height or stack bar height. */
  collapseDistance?: number;
  /** Stack navigator header — collapse full bar + status bar inset. */
  forStackHeader?: boolean;
};

export function useCollapsingHeader(options: Options = {}) {
  const insets = useSafeAreaInsets();
  const [measuredHeight, setMeasuredHeight] = useState(STACK_BAR_HEIGHT);
  const translateY = useRef(new Animated.Value(0)).current;
  const offsetRef = useRef(0);
  const lastScrollYRef = useRef(0);

  const stackBarHeight = STACK_BAR_HEIGHT;
  const stackHeaderHeight = stackBarHeight + insets.top;
  const collapseDistance =
    options.collapseDistance ??
    (options.forStackHeader ? stackHeaderHeight : measuredHeight);

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
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

      let next = offsetRef.current - dy;
      next = Math.max(-collapseDistance, Math.min(0, next));
      if (next !== offsetRef.current) {
        offsetRef.current = next;
        translateY.setValue(next);
      }
    },
    [collapseDistance, translateY],
  );

  const resetHeader = useCallback(() => {
    offsetRef.current = 0;
    lastScrollYRef.current = 0;
    translateY.setValue(0);
  }, [translateY]);

  const mergeOnScroll = useCallback(
    (...handlers: Array<(e: NativeSyntheticEvent<NativeScrollEvent>) => void>) =>
      (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        onScroll(e);
        handlers.forEach((handler) => handler?.(e));
      },
    [onScroll],
  );

  const headerTranslateStyle = {
    transform: [{ translateY }],
  };

  return {
    translateY,
    onScroll,
    mergeOnScroll,
    resetHeader,
    headerTranslateStyle,
    measuredHeight,
    setMeasuredHeight,
    stackHeaderHeight,
    stackBarHeight,
    topInset: insets.top,
  };
}
