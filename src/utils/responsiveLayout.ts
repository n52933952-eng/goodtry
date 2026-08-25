/**
 * Wide-screen helpers. Phones are left untouched: the cap only kicks in past
 * TABLET_MIN_WIDTH, so a tablet shows the same UI centered instead of stretched.
 */

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

export const TABLET_MIN_WIDTH = 700;
const DEFAULT_CONTENT_MAX_WIDTH = 620;

export type WideScreenLayout = {
  isWide: boolean;
  /** Spread onto a contentContainerStyle / wrapper to centre and cap the content. */
  contentCap: { maxWidth: number; width: '100%'; alignSelf: 'center' } | null;
};

export function useWideScreenLayout(maxWidth = DEFAULT_CONTENT_MAX_WIDTH): WideScreenLayout {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const isWide = width >= TABLET_MIN_WIDTH;
    return {
      isWide,
      contentCap: isWide ? { maxWidth, width: '100%' as const, alignSelf: 'center' as const } : null,
    };
  }, [width, maxWidth]);
}
