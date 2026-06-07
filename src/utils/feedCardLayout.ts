/**
 * Gentle feed card scaling — baseline ~6.5" phone (390×812).
 * Same scale curve as live UI: looks identical on your phone, adjusts slightly on small/large devices.
 */

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { computeLiveScale, s } from './liveScreenLayout';

export type FeedCardMetrics = {
  scale: number;
  screenWidth: number;
  cardPadding: number;
  cardRadius: number;
  cardMarginV: number;
  mediaHeight: number;
  bleedMargin: number;
  headerAvatar: number;
  storyRingOuter: number;
  headerNameSize: number;
  headerUserSize: number;
  headerTimeSize: number;
  bodyTextSize: number;
  liveAvatar: number;
  liveNameSize: number;
  liveSubSize: number;
  liveBadgeSize: number;
  livePlaceholderSize: number;
  watchBtnPadV: number;
  watchBtnPadH: number;
  watchBtnTextSize: number;
  liveOverlayTop: number;
  liveOverlayLeft: number;
};

export function buildFeedCardMetrics(width: number, height: number): FeedCardMetrics {
  const scale = computeLiveScale(width, height);
  const cardPadding = s(12, scale);

  return {
    scale,
    screenWidth: width,
    cardPadding,
    cardRadius: s(16, scale),
    cardMarginV: s(8, scale),
    mediaHeight: s(220, scale),
    bleedMargin: -cardPadding,
    headerAvatar: s(45, scale),
    storyRingOuter: s(50, scale),
    headerNameSize: s(16, scale),
    headerUserSize: s(14, scale),
    headerTimeSize: s(14, scale),
    bodyTextSize: s(15, scale),
    liveAvatar: s(36, scale),
    liveNameSize: s(14, scale),
    liveSubSize: s(12, scale),
    liveBadgeSize: s(13, scale),
    livePlaceholderSize: s(32, scale),
    watchBtnPadV: s(6, scale),
    watchBtnPadH: s(16, scale),
    watchBtnTextSize: s(13, scale),
    liveOverlayTop: s(10, scale),
    liveOverlayLeft: s(10, scale),
  };
}

export function useFeedCardMetrics(): FeedCardMetrics {
  const { width, height } = useWindowDimensions();
  return useMemo(() => buildFeedCardMetrics(width, height), [width, height]);
}
