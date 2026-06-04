import React, { useRef, useState, useCallback, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  PanResponder,
  Dimensions,
  type LayoutChangeEvent,
} from 'react-native';

const { width: SW } = Dimensions.get('window');
const PIP_W = 100;
const PIP_H = 136;

type Bounds = { w: number; h: number };

type Props = {
  children: React.ReactNode;
  label?: string;
  initialX?: number;
  initialY?: number;
  /** Parent already measured the overlay — avoids two full-screen hosts fighting layout. */
  bounds?: Bounds;
};

const DraggableCallPip = ({
  children,
  label,
  initialX = SW - PIP_W - 16,
  initialY = 56,
  bounds,
}: Props) => {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const posRef = useRef(pos);
  posRef.current = pos;
  const parentSize = useRef({ w: SW, h: 800 });
  const dragOrigin = useRef({ x: initialX, y: initialY });
  const isDragging = useRef(false);
  const hasUserMoved = useRef(false);

  const clampPos = useCallback((x: number, y: number) => {
    const maxX = Math.max(0, parentSize.current.w - PIP_W);
    const maxY = Math.max(0, parentSize.current.h - PIP_H);
    return {
      x: Math.min(maxX, Math.max(0, x)),
      y: Math.min(maxY, Math.max(0, y)),
    };
  }, []);

  const applyBounds = useCallback((w: number, h: number) => {
    if (w <= 0 || h <= 0) return;
    parentSize.current = { w, h };
    if (isDragging.current) return;
    if (!hasUserMoved.current) {
      setPos(clampPos(initialX, initialY));
    } else {
      setPos((p) => clampPos(p.x, p.y));
    }
  }, [clampPos, initialX, initialY]);

  useEffect(() => {
    if (bounds?.w && bounds?.h) applyBounds(bounds.w, bounds.h);
  }, [bounds?.w, bounds?.h, applyBounds]);

  const onParentLayout = useCallback((e: LayoutChangeEvent) => {
    if (bounds) return;
    const { width, height } = e.nativeEvent.layout;
    applyBounds(width, height);
  }, [bounds, applyBounds]);

  const panResponder = useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        isDragging.current = true;
        dragOrigin.current = { ...posRef.current };
      },
      onPanResponderMove: (_, g) => {
        hasUserMoved.current = true;
        setPos(clampPos(dragOrigin.current.x + g.dx, dragOrigin.current.y + g.dy));
      },
      onPanResponderRelease: (_, g) => {
        isDragging.current = false;
        setPos(clampPos(dragOrigin.current.x + g.dx, dragOrigin.current.y + g.dy));
      },
      onPanResponderTerminate: () => {
        isDragging.current = false;
      },
    }),
    [clampPos],
  );

  const pip = (
    <View style={[styles.pip, { left: pos.x, top: pos.y }]} {...panResponder.panHandlers}>
      {label ? (
        <View style={styles.labelPill} pointerEvents="none">
          <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );

  if (bounds) return pip;

  return (
    <View style={styles.host} onLayout={onParentLayout} pointerEvents="box-none">
      {pip}
    </View>
  );
};

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  pip: {
    position: 'absolute',
    width: PIP_W,
    height: PIP_H,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.35)',
    backgroundColor: '#000',
  },
  labelPill: {
    position: 'absolute',
    bottom: 4,
    left: 4,
    right: 4,
    zIndex: 2,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  labelText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
});

export { PIP_W, PIP_H };
export default DraggableCallPip;
