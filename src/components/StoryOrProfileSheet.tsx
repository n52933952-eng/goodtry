import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useLanguage } from '../context/LanguageContext';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** @username shown under title */
  username?: string;
  onSeeStory: () => void;
  onGoToProfile?: () => void;
};

/**
 * Replaces system Alert for story vs profile — matches app theme and is easier to read.
 */
const StoryOrProfileSheet: React.FC<Props> = ({
  visible,
  onClose,
  username,
  onSeeStory,
  onGoToProfile,
}) => {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { t } = useLanguage();
  const showProfile = typeof onGoToProfile === 'function';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.backgroundLight,
              paddingBottom: Math.max(insets.bottom, 16) + 8,
              borderColor: colors.border,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text style={[styles.title, { color: colors.text }]}>Story & profile</Text>
          {!!username && (
            <Text style={[styles.subtitle, { color: colors.textGray }]} numberOfLines={1}>
              @{username}
            </Text>
          )}

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
            onPress={() => {
              onSeeStory();
              onClose();
            }}
            activeOpacity={0.88}
          >
            <Text style={[styles.primaryBtnText, { color: colors.buttonText }]}>See story</Text>
          </TouchableOpacity>

          {showProfile && (
            <TouchableOpacity
              style={[styles.secondaryBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
              onPress={() => {
                onGoToProfile?.();
                onClose();
              }}
              activeOpacity={0.88}
            >
              <Text style={[styles.secondaryBtnText, { color: colors.text }]}>Go to profile</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={styles.cancelWrap} onPress={onClose} hitSlop={12}>
            <Text style={[styles.cancelText, { color: colors.textGray }]}>{t('cancel')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 20,
  },
  primaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 8,
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  cancelWrap: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default StoryOrProfileSheet;
