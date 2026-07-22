import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, Platform } from 'react-native';
import {
  NativeAd,
  NativeAdView,
  NativeAsset,
  NativeAssetType,
  NativeMediaView,
  TestIds,
} from 'react-native-google-mobile-ads';
import { useTheme } from '../../context/ThemeContext';

/** Production Native Advanced unit: FeedNative */
const PROD_NATIVE_UNIT = 'ca-app-pub-4967868662952223/2789083891';

const adUnitId = __DEV__ ? TestIds.NATIVE : PROD_NATIVE_UNIT;

type Props = {
  /** Stable key so FlatList remounts don't thrash unnecessarily */
  slotKey?: string;
};

/**
 * AdMob Native Advanced card styled like a feed post (Sponsored + media).
 */
export default function FeedNativeAd({ slotKey = 'feed' }: Props) {
  const { colors } = useTheme();
  const [nativeAd, setNativeAd] = useState<NativeAd | null>(null);

  useEffect(() => {
    let alive = true;
    let ad: NativeAd | null = null;

    NativeAd.createForAdRequest(adUnitId)
      .then((loaded) => {
        if (!alive) {
          loaded.destroy();
          return;
        }
        ad = loaded;
        setNativeAd(loaded);
      })
      .catch((err) => {
        if (__DEV__) console.warn('[AdMob] Native load failed', slotKey, err?.message || err);
      });

    return () => {
      alive = false;
      ad?.destroy();
      setNativeAd(null);
    };
  }, [slotKey]);

  if (!nativeAd) {
    return (
      <View style={[styles.card, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
        <Text style={[styles.sponsored, { color: colors.textGray }]}>Sponsored</Text>
        <View style={[styles.placeholder, { backgroundColor: colors.border }]} />
      </View>
    );
  }

  return (
    <NativeAdView
      nativeAd={nativeAd}
      style={[styles.card, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
    >
      <View style={styles.headerRow}>
        {nativeAd.icon?.url ? (
          <NativeAsset assetType={NativeAssetType.ICON}>
            <Image source={{ uri: nativeAd.icon.url }} style={styles.icon} />
          </NativeAsset>
        ) : (
          <View style={[styles.iconPlaceholder, { backgroundColor: colors.border }]}>
            <Text style={{ color: colors.textGray, fontWeight: '700' }}>Ad</Text>
          </View>
        )}
        <View style={styles.headerText}>
          <NativeAsset assetType={NativeAssetType.HEADLINE}>
            <Text style={[styles.headline, { color: colors.text }]} numberOfLines={2}>
              {nativeAd.headline}
            </Text>
          </NativeAsset>
          <Text style={[styles.sponsored, { color: colors.textGray }]}>Sponsored</Text>
        </View>
      </View>

      {nativeAd.body ? (
        <NativeAsset assetType={NativeAssetType.BODY}>
          <Text style={[styles.body, { color: colors.textGray }]} numberOfLines={3}>
            {nativeAd.body}
          </Text>
        </NativeAsset>
      ) : null}

      <View style={[styles.mediaWrap, { borderColor: colors.border, backgroundColor: '#000' }]}>
        <NativeMediaView style={styles.media} />
      </View>

      {nativeAd.callToAction ? (
        <NativeAsset assetType={NativeAssetType.CALL_TO_ACTION}>
          <View style={[styles.cta, { backgroundColor: colors.primary }]}>
            <Text style={styles.ctaText}>{nativeAd.callToAction}</Text>
          </View>
        </NativeAsset>
      ) : null}
    </NativeAdView>
  );
}

/** Insert a native ad after every N posts (2 = post, post, ad…). */
export const FEED_AD_EVERY = 2;

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginVertical: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
  },
  iconPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headline: {
    fontSize: 15,
    fontWeight: '700',
  },
  sponsored: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  body: {
    fontSize: 13,
    marginBottom: 8,
  },
  mediaWrap: {
    borderWidth: 1,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 10,
  },
  media: {
    width: '100%',
    height: Platform.OS === 'ios' ? 180 : 200,
  },
  cta: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
  placeholder: {
    height: 160,
    borderRadius: 8,
    marginTop: 8,
  },
});
