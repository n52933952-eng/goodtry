import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';

const MAX_LEN = 500;

type Props = {
  visible: boolean;
  onClose: () => void;
  post: any;
  onSaved: (updated: any) => void;
};

const EditPostModal: React.FC<Props> = ({ visible, onClose, post, onSaved }) => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && post) {
      setText(post.text || '');
    }
  }, [visible, post?._id, post?.text]);

  const handleSave = async () => {
    if (!post?._id) return;
    const trimmed = text.trim();
    if (!trimmed) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      showToast(t('error'), t('postTextTooLong'), 'error');
      return;
    }
    setSaving(true);
    try {
      const data = await apiService.put(`${ENDPOINTS.UPDATE_POST}/${post._id}`, { text: trimmed });
      const updated = data?.post ?? data;
      if (updated?._id) {
        showToast(t('success'), t('postUpdatedSuccessfully'), 'success');
        onSaved(updated);
        onClose();
      } else {
        showToast(t('error'), t('failedToUpdatePost'), 'error');
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToUpdatePost'), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.backgroundLight }]}>
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose}>
              <Text style={{ color: colors.textGray, fontSize: 16 }}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]}>{t('editPost')}</Text>
            <TouchableOpacity onPress={handleSave} disabled={saving}>
              {saving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>{t('save')}</Text>
              )}
            </TouchableOpacity>
          </View>
          <TextInput
            style={[
              styles.input,
              { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
            ]}
            multiline
            maxLength={MAX_LEN}
            value={text}
            onChangeText={setText}
            placeholder={t('whatsOnYourMind')}
            placeholderTextColor={colors.textGray}
          />
          <Text style={[styles.counter, { color: colors.textGray }]}>
            {MAX_LEN - (text?.length || 0)}
          </Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
  },
  input: {
    marginTop: 12,
    marginHorizontal: 16,
    minHeight: 140,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  counter: {
    marginHorizontal: 16,
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
  },
});

export default EditPostModal;
