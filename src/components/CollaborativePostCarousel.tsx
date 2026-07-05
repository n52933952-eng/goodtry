import React, { useRef, useState } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  NativeSyntheticEvent,
  NativeScrollEvent,
  StyleProp,
  ViewStyle,
  LayoutChangeEvent,
} from 'react-native';
import SafeImage from './SafeImage';
import { mediaDisplayUrl } from '../utils/mediaUrl';
import type { CollaborativeCarouselSlide } from '../utils/collaborativeCarousel';

type Props = {
  slides: CollaborativeCarouselSlide[];
  containerStyle?: StyleProp<ViewStyle>;
  slideHeight?: number;
  onPressSlide?: () => void;
  onPressImagePreview?: (uri: string) => void;
};

const CollaborativePostCarousel: React.FC<Props> = ({
  slides,
  containerStyle,
  slideHeight = 280,
  onPressSlide,
  onPressImagePreview,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const listRef = useRef<FlatList<CollaborativeCarouselSlide>>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && w !== layoutWidth) setLayoutWidth(w);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const w = layoutWidth || 1;
    const i = Math.round(e.nativeEvent.contentOffset.x / w);
    if (i >= 0 && i < slides.length && i !== activeIndex) setActiveIndex(i);
  };

  if (!slides.length) return null;

  const slideW = layoutWidth > 0 ? layoutWidth : undefined;

  return (
    <View style={containerStyle} onLayout={onLayout}>
      <FlatList
        ref={listRef}
        data={slides}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(item) => item.userId}
        onScroll={onScroll}
        scrollEventThrottle={16}
        getItemLayout={
          slideW
            ? (_, index) => ({ length: slideW, offset: slideW * index, index })
            : undefined
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={0.95}
            onPress={() => {
              if (onPressImagePreview) onPressImagePreview(item.img);
              else if (onPressSlide) onPressSlide();
            }}
            disabled={!onPressSlide && !onPressImagePreview}
            style={[styles.slide, slideW ? { width: slideW, height: slideHeight } : { height: slideHeight }]}
          >
            <SafeImage
              source={{ uri: mediaDisplayUrl(item.img) }}
              style={styles.image}
              resizeMode="contain"
            />
            {(item.name || item.username) ? (
              <View style={styles.badge} pointerEvents="none">
                <Text style={styles.badgeText} numberOfLines={1}>
                  {item.name || item.username}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        )}
      />
      {slides.length > 1 ? (
        <View style={styles.dots} pointerEvents="none">
          {slides.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  slide: {
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  badge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: '70%',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(128,128,128,0.45)',
  },
  dotActive: {
    backgroundColor: '#3897f0',
    width: 7,
    height: 7,
    borderRadius: 4,
  },
});

export default CollaborativePostCarousel;
