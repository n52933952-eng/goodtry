import React, { useEffect, useState } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { createThumbnail } from 'react-native-create-thumbnail';
import SafeImage from './SafeImage';

const uriCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();
/**
 * Negative cache: video URLs that failed every timestamp. Stops a broken video
 * (e.g. asset on a deleted Cloudinary account) from triggering 8 native
 * createThumbnail calls on every FlatList row recycle.
 */
const failedVideoCache = new Set<string>();

function toFileUri(path: string): string {
  if (!path) return path;
  return path.startsWith('file://') ? path : `file://${path}`;
}

function loadLocalThumbnail(videoUrl: string, preferredTimeMs: number): Promise<string | null> {
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
            maxHeight: 540,
          });
          const uri = toFileUri(res.path);
          uriCache.set(cacheKey, uri);
          inflight.delete(cacheKey);
          return uri;
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
}) => {
  const server = serverThumbnail?.trim() || '';
  const [uri, setUri] = useState<string | null>(server || null);
  const [generating, setGenerating] = useState(!server);

  useEffect(() => {
    const thumb = serverThumbnail?.trim();
    if (thumb) {
      setUri(thumb);
      setGenerating(false);
      return;
    }

    let cancelled = false;
    setGenerating(true);
    loadLocalThumbnail(videoUrl, preferredTimeMs).then((local) => {
      if (cancelled) return;
      if (local) {
        setUri(local);
      }
      setGenerating(false);
    });

    return () => {
      cancelled = true;
    };
  }, [videoUrl, serverThumbnail, preferredTimeMs]);

  return (
    <>
      {uri ? (
        <SafeImage
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
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
