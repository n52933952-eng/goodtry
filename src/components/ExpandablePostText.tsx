import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleProp,
  TextStyle,
  ViewStyle,
  NativeSyntheticEvent,
  TextLayoutEventData,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';

type Props = {
  text: string;
  style?: StyleProp<TextStyle>;
  color?: string;
  accentColor?: string;
  onPress?: () => void;
  wrapperStyle?: StyleProp<ViewStyle>;
};

const ExpandablePostText: React.FC<Props> = ({
  text,
  style,
  color,
  accentColor,
  onPress,
  wrapperStyle,
}) => {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const trimmed = String(text || '').trim();

  useEffect(() => {
    setExpanded(false);
    setTruncated(false);
  }, [trimmed]);

  const onMeasureLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      if (expanded) return;
      const lines = e.nativeEvent.lines || [];
      if (lines.length > 1) setTruncated(true);
    },
    [expanded],
  );

  if (!trimmed) return null;

  const body = (
    <View style={wrapperStyle}>
      {!expanded ? (
        <Text
          style={[style, { color, position: 'absolute', opacity: 0, width: '100%' }]}
          onTextLayout={onMeasureLayout}
          accessible={false}
          importantForAccessibility="no-hide-descendants"
        >
          {trimmed}
        </Text>
      ) : null}
      <Text style={[style, { color, marginBottom: truncated && !expanded ? 0 : undefined }]} numberOfLines={expanded ? undefined : 1}>
        {trimmed}
      </Text>
      {truncated && !expanded ? (
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation?.();
            setExpanded(true);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ alignSelf: 'flex-start', marginBottom: 10 }}
        >
          <Text style={{ color: accentColor || color, fontSize: 14, fontWeight: '600' }}>
            {t('showMore')}
          </Text>
        </TouchableOpacity>
      ) : null}
      {truncated && expanded ? (
        <TouchableOpacity
          onPress={(e) => {
            e.stopPropagation?.();
            setExpanded(false);
          }}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          style={{ alignSelf: 'flex-start', marginBottom: 10 }}
        >
          <Text style={{ color: accentColor || color, fontSize: 14, fontWeight: '600' }}>
            {t('showLess')}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (onPress && !expanded) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
        {body}
      </TouchableOpacity>
    );
  }

  return body;
};

export default ExpandablePostText;
