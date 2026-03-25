import React, { useEffect, useState } from 'react';
import {
  View,
  Image,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { createThumbnail } from 'react-native-create-thumbnail';

const uriCache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

function toFileUri(path: string): string {
  if (!path) return path;
  return path.startsWith('file://') ? path : `file://${path}`;
}

function loadLocalThumbnail(videoUrl: string): Promise<string | null> {
  const hit = uriCache.get(videoUrl);
  if (hit) {
    return Promise.resolve(hit);
  }
  let p = inflight.get(videoUrl);
  if (!p) {
    p = createThumbnail({
      url: videoUrl,
      timeStamp: 1000,
      format: 'jpeg',
      maxWidth: 960,
      maxHeight: 540,
    })
      .then((res) => {
        const uri = toFileUri(res.path);
        uriCache.set(videoUrl, uri);
        inflight.delete(videoUrl);
        return uri;
      })
      .catch((e) => {
        inflight.delete(videoUrl);
        console.warn('[VideoFeedPreview] createThumbnail failed', e?.message || e);
        return null;
      });
    inflight.set(videoUrl, p);
  }
  return p;
}

type Props = {
  videoUrl: string;
  serverThumbnail?: string | null;
  placeholderColor: string;
  spinnerColor: string;
};

/**
 * Poster for feed video rows: server thumbnail if present, else a frame from the video URL.
 */
const VideoFeedPreview: React.FC<Props> = ({
  videoUrl,
  serverThumbnail,
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
    loadLocalThumbnail(videoUrl).then((local) => {
      if (cancelled) return;
      if (local) {
        setUri(local);
      }
      setGenerating(false);
    });

    return () => {
      cancelled = true;
    };
  }, [videoUrl, serverThumbnail]);

  return (
    <>
      {uri ? (
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFillObject}
          resizeMode="cover"
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
