import React, { useEffect, useRef, useMemo } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const TRACK_GRAY = '#9CA3AF';
const FILL_RED = '#FF3040';

type Props = {
  visible: boolean;
  /**
   * True only for **unopened** someone else’s story: gray track + red fills on each `replayKey`.
   * False for your own story or any **already-seen** story → **gray ring only** (no red).
   */
  showAnimatedRedFill: boolean;
  replayKey: number;
  children: React.ReactNode;
  style?: ViewStyle;
  ringOuterSize?: number;
  avatarSize?: number;
  strokeWidth?: number;
  fillDurationMs?: number;
};

/**
 * Unseen others’ stories: gray ring + animated red fill (replays on feed/profile focus).
 * Seen / your own active story: static gray ring only.
 * No active story: `visible` false → plain avatar.
 */
const StoryAvatarRing: React.FC<Props> = ({
  visible,
  showAnimatedRedFill,
  replayKey,
  children,
  style,
  ringOuterSize = 50,
  avatarSize = 45,
  strokeWidth = 2,
  fillDurationMs = 2000,
}) => {
  const strokeDashoffset = useRef(new Animated.Value(0)).current;
  const animRef = useRef<{ stop: () => void } | null>(null);

  const { cx, r, circumference } = useMemo(() => {
    const c = ringOuterSize / 2;
    const radius = Math.max(1, c - strokeWidth / 2);
    const circ = 2 * Math.PI * radius;
    return { cx: c, r: radius, circumference: circ };
  }, [ringOuterSize, strokeWidth]);

  useEffect(() => {
    animRef.current?.stop?.();

    if (!visible || !showAnimatedRedFill) {
      strokeDashoffset.setValue(0);
      return;
    }

    strokeDashoffset.setValue(circumference);
    const anim = Animated.timing(strokeDashoffset, {
      toValue: 0,
      duration: fillDurationMs,
      useNativeDriver: false,
    });
    animRef.current = anim;
    anim.start();

    return () => {
      anim.stop();
    };
  }, [
    visible,
    showAnimatedRedFill,
    replayKey,
    circumference,
    strokeDashoffset,
    fillDurationMs,
  ]);

  if (!visible) {
    return <View style={[styles.wrap, style]}>{children}</View>;
  }

  // Seen / own story: one static gray ring only (no red)
  if (!showAnimatedRedFill) {
    return (
      <View
        style={[
          styles.wrap,
          {
            width: ringOuterSize,
            height: ringOuterSize,
          },
          style,
        ]}
      >
        <Svg
          width={ringOuterSize}
          height={ringOuterSize}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        >
          <Circle
            cx={cx}
            cy={cx}
            r={r}
            stroke={TRACK_GRAY}
            strokeWidth={strokeWidth}
            fill="none"
          />
        </Svg>
        <View
          style={{
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            overflow: 'hidden',
          }}
        >
          {children}
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        {
          width: ringOuterSize,
          height: ringOuterSize,
        },
        style,
      ]}
    >
      <Svg
        width={ringOuterSize}
        height={ringOuterSize}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      >
        <Circle
          cx={cx}
          cy={cx}
          r={r}
          stroke={TRACK_GRAY}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <G transform={`rotate(-90, ${cx}, ${cx})`}>
          <AnimatedCircle
            cx={cx}
            cy={cx}
            r={r}
            stroke={FILL_RED}
            strokeWidth={strokeWidth}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={strokeDashoffset}
          />
        </G>
      </Svg>
      <View
        style={{
          width: avatarSize,
          height: avatarSize,
          borderRadius: avatarSize / 2,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default StoryAvatarRing;
