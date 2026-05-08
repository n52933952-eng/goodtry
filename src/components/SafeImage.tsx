import React, { useCallback, useEffect, useState } from 'react';
import { Image, ImageProps, ImageStyle, StyleProp, View } from 'react-native';

type SafeImageProps = ImageProps & {
  /** Optional element to render when the image fails to load. Defaults to an empty View matching `style`. */
  fallback?: React.ReactNode;
};

/**
 * Image wrapper that stops trying to render a remote source once it fails.
 * Old/expired Cloudinary URLs (e.g. assets from a deleted account) can pile up
 * in Fresco/Glide retry queues across a long feed and pressure memory enough
 * to crash a release APK. Once an URL errors here we render a placeholder
 * instead of feeding the same broken URL back to the native image pipeline.
 */
const SafeImage: React.FC<SafeImageProps> = ({ source, style, fallback, onError, ...rest }) => {
  const uri =
    source && typeof source === 'object' && !Array.isArray(source)
      ? (source as { uri?: string }).uri ?? null
      : null;

  const [failed, setFailed] = useState(false);

  // Reset failed state if the URI changes (FlatList row recycle, edited post, etc.)
  useEffect(() => {
    setFailed(false);
  }, [uri]);

  const handleError = useCallback(
    (e: Parameters<NonNullable<ImageProps['onError']>>[0]) => {
      setFailed(true);
      onError?.(e);
    },
    [onError],
  );

  if (failed) {
    if (fallback !== undefined) return <>{fallback}</>;
    return <View style={style as StyleProp<ImageStyle>} />;
  }

  return <Image source={source} style={style} onError={handleError} {...rest} />;
};

export default SafeImage;
