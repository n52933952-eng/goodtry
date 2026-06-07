/**
 * Gentle live UI scaling — baseline ~6.5" phone (390×812).
 * Clamped so normal phones look the same; small/large phones adjust slightly.
 */

import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const REF_W = 390;
const REF_H = 812;
const SCALE_MIN = 0.88;
const SCALE_MAX = 1.12;

export function computeLiveScale(width: number, height: number): number {
  const h = height / REF_H;
  const w = width / REF_W;
  const blended = h * 0.72 + w * 0.28;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, blended));
}

export function s(size: number, scale: number): number {
  return Math.round(size * scale);
}

export type LiveScreenMetrics = {
  scale: number;
  pillH: number;
  actionCircle: number;
  actionSlotH: number;
  actionRailWidth: number;
  actionRailRight: number;
  actionRailGutter: number;
  chatLogH: number;
  floatChatStackH: number;
  floatChatMaxH: number;
  topBarTop: number;
  liveTopBarClear: number;
  reactionAreaHeight: number;
  emojiPickerBtn: number;
  emojiPickerEmoji: number;
  emojiPickerMaxW: number;
  floatReactionEmoji: number;
  actionIconSize: number;
  actionLabelSize: number;
  viewerRailBottomExtra: number;
  broadcasterRailBottomExtra: number;
  pipTopInsetExtra: number;
  pipBottomPad: number;
  keyboardLogH: number;
};

export function buildLiveScreenMetrics(
  width: number,
  height: number,
  topInset: number,
  bottomInset: number,
): LiveScreenMetrics {
  const scale = computeLiveScale(width, height);
  const topBarTop = Math.max(topInset, 10) + s(8, scale);

  return {
    scale,
    pillH: s(46, scale),
    actionCircle: s(50, scale),
    actionSlotH: s(82, scale),
    actionRailWidth: s(76, scale),
    actionRailRight: s(10, scale),
    actionRailGutter: s(88, scale),
    chatLogH: s(180, scale),
    floatChatStackH: s(200, scale),
    floatChatMaxH: Math.min(s(400, scale), Math.round(height * 0.45)),
    topBarTop,
    liveTopBarClear: topBarTop + s(40, scale),
    reactionAreaHeight: s(280, scale),
    emojiPickerBtn: s(38, scale),
    emojiPickerEmoji: s(24, scale),
    emojiPickerMaxW: s(280, scale),
    floatReactionEmoji: s(42, scale),
    actionIconSize: s(22, scale),
    actionLabelSize: s(11, scale),
    viewerRailBottomExtra: s(112, scale),
    broadcasterRailBottomExtra: s(58, scale),
    pipTopInsetExtra: s(44, scale),
    pipBottomPad: s(88, scale),
    keyboardLogH: s(112, scale),
  };
}

export function useLiveScreenMetrics(): LiveScreenMetrics {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return useMemo(
    () => buildLiveScreenMetrics(width, height, insets.top, insets.bottom),
    [width, height, insets.top, insets.bottom],
  );
}

export function getScaledPipSizeSteps(scale: number) {
  const base = [
    { w: 72, h: 96 },
    { w: 96, h: 128 },
    { w: 128, h: 171 },
    { w: 168, h: 224 },
  ] as const;
  return base.map(({ w, h }) => ({ w: s(w, scale), h: s(h, scale) }));
}

/** Shared action-rail styles — keeps broadcaster + viewer in sync. */
export function liveActionStyles(m: LiveScreenMetrics, railSlots: number) {
  return {
    actionRail: {
      right: m.actionRailRight,
      width: m.actionRailWidth,
      height: m.actionSlotH * railSlots,
    },
    actionSlot: { height: m.actionSlotH },
    actionSlotReserved: {
      width: m.actionCircle,
      height: m.actionCircle + s(18, m.scale),
    },
    actionCircle: {
      width: m.actionCircle,
      height: m.actionCircle,
    },
    actionIcon: { fontSize: m.actionIconSize },
    actionLabel: { fontSize: m.actionLabelSize, maxWidth: s(72, m.scale) },
    textInput: { height: m.pillH },
    sendBtn: { height: m.pillH, minWidth: s(72, m.scale) },
    topBar: { top: m.topBarTop },
    floatArea: { right: m.actionRailGutter },
    logPanel: { right: m.actionRailGutter, height: m.chatLogH },
    reactionArea: { height: m.reactionAreaHeight },
    floatReactionEmoji: { fontSize: m.floatReactionEmoji },
    emojiPickerAnchor: { right: m.actionRailGutter - s(2, m.scale), maxWidth: m.emojiPickerMaxW },
    emojiPickerBtn: { width: m.emojiPickerBtn, height: m.emojiPickerBtn, borderRadius: m.emojiPickerBtn / 2 },
    emojiPickerEmoji: { fontSize: m.emojiPickerEmoji, lineHeight: m.emojiPickerEmoji },
  };
}
