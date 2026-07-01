import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Image,
} from 'react-native';
import { createThumbnail } from 'react-native-create-thumbnail';
import SafeImage from './SafeImage';

type ThumbResult = { uri: string; width: number; height: number };

const uriCache = new Map<string, ThumbResult>();
const inflight = new Map<string, Promise<ThumbResult | null>>();
/**
 * Negative cache: video URLs that failed every timestamp. Stops a broken video
 * (e.g. asset on a deleted remote account) from triggering 8 native
 * createThumbnail calls on every FlatList row recycle.
 */
const failedVideoCache = new Set<string>();

function toFileUri(path: string): string {
  if (!path) return path;
  return path.startsWith('file://') ? path : `file://${path}`;
}

function loadLocalThumbnail(videoUrl: string, preferredTimeMs: number): Promise<ThumbResult | null> {
  const base = Math.max(0, Math.floor(preferredTimeMs || 0));
  const cacheKey = `${videoUrl}#t=${base}`;
  const hit = uriCache.get(cacheKey);
  if (hit) {
    return Promise.resolve(hit);
  }
  // Don't keep slamming the native bridge for a video whose source URL is dead.
  if (failedVideoCache.has(videoUrl)) {
    return Promise.resolve(null);
  }
  let p = inflight.get(cacheKey);
  if (!p) {
    const timeStamps = [
      base,
      Math.max(0, base - 500),
      base + 500,
      base + 1200,
      1200,
      2500,
      4500,
      7000,
    ];
    p = (async () => {
      for (const ms of timeStamps) {
        try {
          const res = await createThumbnail({
            url: videoUrl,
            timeStamp: ms,
            format: 'jpeg',
            maxWidth: 960,
            maxHeight: 960,
          });
          const result: ThumbResult = {
            uri: toFileUri(res.path),
            width: Number(res.width) || 0,
            height: Number(res.height) || 0,
          };
          uriCache.set(cacheKey, result);
          inflight.delete(cacheKey);
          return result;
        } catch (e: any) {
          // Try next timestamp — early frames are often black.
          if (ms === timeStamps[timeStamps.length - 1]) {
            console.warn('[VideoFeedPreview] createThumbnail failed', e?.message || e);
            failedVideoCache.add(videoUrl);
          }
        }
      }
      inflight.delete(cacheKey);
      return null;
    })();
    inflight.set(cacheKey, p);
  }
  return p;
}

type Props = {
  videoUrl: string;
  serverThumbnail?: string | null;
  preferredTimeMs?: number;
  placeholderColor: string;
  spinnerColor: string;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  /** Reports the poster's real aspect ratio (width / height) once known. */
  onAspectRatio?: (aspect: number) => void;
};

/**
 * Poster for feed video rows: server thumbnail if present, else a frame from the video URL.
 */
const VideoFeedPreview: React.FC<Props> = ({
  videoUrl,
  serverThumbnail,
  preferredTimeMs = 1000,
  placeholderColor,
  spinnerColor,
  resizeMode = 'contain',
  onAspectRatio,
}) => {
  const server = serverThumbnail?.trim() || '';
  const [uri, setUri] = useState<string | null>(server || null);
  const [generating, setGenerating] = useState(!server);

  useEffect(() => {
    const thumb = serverThumbnail?.trim();
    if (thumb) {
      setUri(thumb);
      setGenerating(false);
      // Server thumbnail: read its natural size to derive aspect ratio.
      if (onAspectRatio) {
        Image.getSize(
          thumb,
          (w, h) => {
            if (w > 0 && h > 0) onAspectRatio(w / h);
          },
          () => {},
        );
      }
      return;
    }

    let cancelled = false;
    setGenerating(true);
    loadLocalThumbnail(videoUrl, preferredTimeMs).then((local) => {
      if (cancelled) return;
      if (local) {
        setUri(local.uri);
        if (onAspectRatio && local.width > 0 && local.height > 0) {
          onAspectRatio(local.width / local.height);
        }
      }
      setGenerating(false);
    });

    return () => {
      cancelled = true;
    };
  }, [videoUrl, serverThumbnail, preferredTimeMs, onAspectRatio]);

  return (
    <>
      {uri ? (
        <SafeImage
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={resizeMode}
          fallback={
            <View
              style={[StyleSheet.absoluteFillObject, { backgroundColor: placeholderColor }]}
            />
          }
        />
      ) : (
        <View
          style={[StyleSheet.absoluteFillObject, { backgroundColor: placeholderColor }]}
        />
      )}
      {generating && (
        <View style={[StyleSheet.absoluteFillObject, styles.spinnerLayer]}>
          <ActivityIndicator size="large" color={spinnerColor} />
        </View>
      )}
    </>
  );
};

const styles = StyleSheet.create({
  spinnerLayer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
});

export default VideoFeedPreview;
