/**
 * Screen share: zoom in, then drag side-to-side / up-down to see hidden parts.
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  StatusBar,
  Dimensions,
  LayoutChangeEvent,
  PanResponder,
} from 'react-native';
import { VideoView } from '@livekit/react-native';

const ZOOM_MIN = 1;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Props = {
  videoTrack: any;
  label?: string;
  style?: object;
  /** Lift controls above chat bars etc. (live viewer). */
  controlsBottom?: number;
};

type ViewportProps = {
  videoTrack: any;
  label?: string;
  full: boolean;
  style?: object;
  controlsBottom?: number;
  onToggleFullscreen: () => void;
};

const ZoomScrollViewport = ({
  videoTrack, label, full, style, controlsBottom = 10, onToggleFullscreen,
}: ViewportProps) => {
  const [zoom, setZoom] = useState(1);
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const zoomRef = useRef(1);
  const vpRef = useRef({ w: 0, h: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  zoomRef.current = zoom;
  vpRef.current = vpSize;
  panRef.current = pan;

  const maxPan = useCallback((z: number, w: number, h: number) => ({
    x: (w * (z - 1)) / 2,
    y: (h * (z - 1)) / 2,
  }), []);

  const clampPan = useCallback((x: number, y: number, z: number, w: number, h: number) => {
    const m = maxPan(z, w, h);
    return { x: clamp(x, -m.x, m.x), y: clamp(y, -m.y, m.y) };
  }, [maxPan]);

  const onViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setVpSize({ w: width, h: height });
    }
  }, []);

  useEffect(() => {
    if (zoom <= 1) {
      setPan({ x: 0, y: 0 });
    } else {
      setPan((p) => clampPan(p.x, p.y, zoom, vpSize.w, vpSize.h));
    }
  }, [zoom, vpSize.w, vpSize.h, clampPan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => zoomRef.current > 1,
        onMoveShouldSetPanResponder: (_, g) =>
          zoomRef.current > 1 && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
        onMoveShouldSetPanResponderCapture: (_, g) =>
          zoomRef.current > 1 && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
        onPanResponderGrant: () => {
          panStartRef.current = { ...panRef.current };
        },
        onPanResponderMove: (_, g) => {
          const z = zoomRef.current;
          const { w, h } = vpRef.current;
          const next = clampPan(
            panStartRef.current.x + g.dx,
            panStartRef.current.y + g.dy,
            z,
            w,
            h,
          );
          setPan(next);
        },
      }),
    [clampPan],
  );

  const zoomIn = useCallback(() => {
    setZoom((z) => clamp(Number((z + ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => clamp(Number((z - ZOOM_STEP).toFixed(2)), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const canPan = zoom > 1 && vpSize.w > 0;
  const zoomLabel = `${Math.round(zoom * 100)}%`;
  /** Android WebRTC surfaces go black inside any transform — only zoom/pan when zoom > 1. */
  const useTransform = zoom > 1;

  return (
    <View style={full ? styles.fullRoot : [styles.stage, style]}>
      <View style={styles.viewport} onLayout={onViewportLayout}>
        {useTransform ? (
          <View style={styles.panLayer}>
            <View
              style={[
                styles.videoFrame,
                vpSize.w > 0 && vpSize.h > 0
                  ? { width: vpSize.w, height: vpSize.h }
                  : StyleSheet.absoluteFillObject,
                {
                  transform: [
                    { translateX: pan.x },
                    { translateY: pan.y },
                    { scale: zoom },
                  ],
                },
              ]}
            >
              <VideoView
                key={`share-${videoTrack?.sid ?? 'screen'}-${full ? 'fs' : 'inline'}-zoom`}
                videoTrack={videoTrack}
                style={StyleSheet.absoluteFill}
                objectFit="contain"
                zOrder={0}
              />
            </View>
          </View>
        ) : (
          <VideoView
            key={`share-${videoTrack?.sid ?? 'screen'}-${full ? 'fs' : 'inline'}`}
            videoTrack={videoTrack}
            style={StyleSheet.absoluteFill}
            objectFit="contain"
            zOrder={0}
          />
        )}
        {canPan && (
          <View style={styles.dragOverlay} {...panResponder.panHandlers} />
        )}
      </View>

      {label ? (
        <View style={[styles.labelPill, full && styles.fullLabel]} pointerEvents="none">
          <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
        </View>
      ) : null}

      {canPan ? (
        <View style={[styles.panHint, full && styles.fullPanHint]} pointerEvents="none">
          <Text style={styles.panHintText}>Drag side to side to see hidden parts</Text>
        </View>
      ) : null}

      <View
        style={[
          styles.controls,
          full && styles.fullControlsTop,
          !full && styles.controlsTop,
        ]}
        pointerEvents="box-none"
      >
        <TouchableOpacity style={styles.ctrlChip} onPress={zoomOut} disabled={zoom <= ZOOM_MIN}>
          <Text style={[styles.ctrlChipText, zoom <= ZOOM_MIN && styles.ctrlDisabled]}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlChip} onPress={resetZoom}>
          <Text style={styles.ctrlChipText}>{zoomLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlChip} onPress={zoomIn} disabled={zoom >= ZOOM_MAX}>
          <Text style={[styles.ctrlChipText, zoom >= ZOOM_MAX && styles.ctrlDisabled]}>+</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.ctrlChip} onPress={onToggleFullscreen}>
          <Text style={styles.ctrlChipText}>{full ? '✕' : '⛶'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const ScreenShareViewer = ({ videoTrack, label, style, controlsBottom }: Props) => {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      {!fullscreen ? (
        <ZoomScrollViewport
          videoTrack={videoTrack}
          label={label}
          full={false}
          style={style}
          controlsBottom={controlsBottom}
          onToggleFullscreen={() => setFullscreen(true)}
        />
      ) : (
        <View style={[styles.stage, style, styles.placeholder]}>
          {label ? (
            <View style={styles.labelPill}>
              <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.expandHint} onPress={() => setFullscreen(true)}>
            <Text style={styles.expandHintText}>⛶ Fullscreen — tap to reopen</Text>
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={fullscreen} animationType="fade" onRequestClose={() => setFullscreen(false)}>
        <StatusBar hidden />
        <ZoomScrollViewport
          videoTrack={videoTrack}
          label={label}
          full
          controlsBottom={controlsBottom}
          onToggleFullscreen={() => setFullscreen(false)}
        />
      </Modal>
    </>
  );
};

const { width: SW, height: SH } = Dimensions.get('window');

const styles = StyleSheet.create({
  stage: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
    borderRadius: 12,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandHint: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  expandHintText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  panLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoFrame: {
    overflow: 'hidden',
  },
  dragOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
    backgroundColor: 'transparent',
  },
  fullRoot: {
    width: SW,
    height: SH,
    backgroundColor: '#000',
  },
  labelPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: '70%',
  },
  fullLabel: {
    top: 48,
  },
  labelText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  panHint: {
    position: 'absolute',
    top: 36,
    left: 8,
    right: 8,
    alignItems: 'center',
  },
  fullPanHint: {
    top: 76,
  },
  panHintText: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  controls: {
    position: 'absolute',
    right: 10,
    flexDirection: 'row',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderRadius: 20,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    zIndex: 30,
  },
  controlsTop: {
    top: 44,
  },
  fullControlsTop: {
    top: 52,
  },
  ctrlChip: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  ctrlChipText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  ctrlDisabled: {
    opacity: 0.35,
  },
});

export default ScreenShareViewer;
