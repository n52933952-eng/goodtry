import React from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  title: string;
  translateY: Animated.Value;
  backgroundColor: string;
  borderColor: string;
  tintColor: string;
  onBackPress: () => void;
  headerRight?: React.ReactNode;
  barHeight?: number;
};

const CollapsingStackHeader: React.FC<Props> = ({
  title,
  translateY,
  backgroundColor,
  borderColor,
  tintColor,
  onBackPress,
  headerRight,
  barHeight = 56,
}) => {
  const insets = useSafeAreaInsets();
  const totalHeight = barHeight + insets.top;

  return (
    <Animated.View
      style={[
        styles.root,
        {
          height: totalHeight,
          paddingTop: insets.top,
          backgroundColor,
          borderBottomColor: borderColor,
          transform: [{ translateY }],
        },
      ]}
    >
      <View style={[styles.row, { height: barHeight }]}>
        <TouchableOpacity
          onPress={onBackPress}
          style={styles.sideBtn}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.backIcon, { color: tintColor }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: tintColor }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.sideBtn}>{headerRight ?? null}</View>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  sideBtn: {
    width: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '700',
  },
});

export default CollapsingStackHeader;
