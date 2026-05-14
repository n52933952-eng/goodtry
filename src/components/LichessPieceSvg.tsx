import React, { memo, useEffect, useState, useRef } from 'react';
import { SvgXml } from 'react-native-svg';
import {
  loadNormalizedPieceSvg,
  peekCachedFlattenedPieceSvg,
  replaceCelticMainGradientFillWithSolid,
  uniquifySvgLocalIds,
} from '../utils/lichessPieceSvgNormalize';

export interface LichessPieceSvgProps {
  uri: string;
  width: number;
  height: number;
}

/**
 * Fetches a Lichess piece SVG, flattens gradient xlink:href chains, and gives each
 * mounted instance unique defs ids so sets that reuse names (celtic, dubrovny) do not
 * cross-resolve `url(#…)` across many pieces on the board.
 */
function preparePieceXml(flat: string, uri: string, instancePrefix: string): string {
  return uniquifySvgLocalIds(replaceCelticMainGradientFillWithSolid(flat, uri), instancePrefix);
}

const LichessPieceSvg = memo(function LichessPieceSvg({
  uri,
  width,
  height,
}: LichessPieceSvgProps) {
  const instancePrefixRef = useRef<string | null>(null);
  if (instancePrefixRef.current == null) {
    instancePrefixRef.current = `p${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 11)}`;
  }
  const instancePrefix = instancePrefixRef.current;

  const [xml, setXml] = useState<string | null>(() => {
    const cached = peekCachedFlattenedPieceSvg(uri);
    return cached ? preparePieceXml(cached, uri, instancePrefix) : null;
  });

  useEffect(() => {
    let cancelled = false;
    const cached = peekCachedFlattenedPieceSvg(uri);
    if (cached) {
      setXml(preparePieceXml(cached, uri, instancePrefix));
    } else {
      setXml(null);
    }
    loadNormalizedPieceSvg(uri)
      .then((x) => {
        if (!cancelled) {
          setXml(preparePieceXml(x, uri, instancePrefix));
        }
      })
      .catch(() => {
        if (!cancelled) setXml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [uri, instancePrefix]);

  if (!xml) {
    return null;
  }

  return <SvgXml xml={xml} width={width} height={height} />;
});

export default LichessPieceSvg;
