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
  ScrollView,
  Image,
  Alert,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useImagePicker } from '../hooks/useImagePicker';

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
  const {
    imageUri,
    imageData,
    isVideo,
    pickImage,
    pickMixedFromGallery,
    pickVideoFromCamera,
    clearImage,
  } = useImagePicker();

  useEffect(() => {
    if (visible && post) {
      setText(post.text || '');
      clearImage();
    }
  }, [visible, post?._id, post?.text]);

  const remoteImg = post?.img ? String(post.img) : '';
  const isRemoteVideo =
    !!remoteImg &&
    (/\.(mp4|webm|ogg|mov)$/i.test(remoteImg) || remoteImg.includes('/video/upload/'));
  const hasRemoteMedia = !!(remoteImg && !remoteImg.includes('youtube'));
  const displayRemoteUri = remoteImg && !imageUri && !remoteImg.includes('youtube') ? remoteImg : null;
  const showNewLocal = !!imageUri;

  const handleSave = async () => {
    if (!post?._id) return;
    const trimmed = text.trim();
    const willUploadNew = !!(imageUri && imageData);

    if (!trimmed && !hasRemoteMedia && !willUploadNew) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      showToast(t('error'), t('postTextTooLong'), 'error');
      return;
    }

    setSaving(true);
    try {
      if (willUploadNew) {
        const formData = new FormData();
        formData.append('text', trimmed);
        const mime =
          imageData?.type || (isVideo ? 'video/mp4' : 'image/jpeg');
        const fallbackExt = mime.includes('video') ? 'mp4' : 'jpg';
        const imageFile = {
          uri: imageUri,
          type: mime,
          name:
            imageData?.fileName ||
            (isVideo ? `video_${Date.now()}.${fallbackExt}` : `image_${Date.now()}.${fallbackExt}`),
        };
        formData.append('file', imageFile as any);

        const data = await apiService.upload(
          `${ENDPOINTS.UPDATE_POST}/${post._id}`,
          formData,
          'PUT'
        );
        const updated = data?.post ?? data;
        if (updated?._id) {
          showToast(t('success'), t('postUpdatedSuccessfully'), 'success');
          onSaved(updated);
          onClose();
        } else {
          showToast(t('error'), t('failedToUpdatePost'), 'error');
        }
      } else {
        const data = await apiService.put(`${ENDPOINTS.UPDATE_POST}/${post._id}`, { text: trimmed });
        const updated = data?.post ?? data;
        if (updated?._id) {
          showToast(t('success'), t('postUpdatedSuccessfully'), 'success');
          onSaved(updated);
          onClose();
        } else {
          showToast(t('error'), t('failedToUpdatePost'), 'error');
        }
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToUpdatePost'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const openMediaPicker = () => {
    Alert.alert(t('selectMedia'), t('chooseOption'), [
      { text: t('camera'), onPress: () => pickImage(true) },
      { text: t('gallery'), onPress: () => pickMixedFromGallery() },
      { text: t('recordVideo'), onPress: () => pickVideoFromCamera() },
      { text: t('cancel'), style: 'cancel' },
    ]);
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
          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
          >
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

            <Text style={[styles.sectionLabel, { color: colors.textGray }]}>{t('media')}</Text>
            {showNewLocal ? (
              <View style={styles.mediaBox}>
                {isVideo ? (
                  <View style={[styles.preview, { justifyContent: 'center', alignItems: 'center' }]}>
                    <Text style={{ color: '#fff' }}>📹 {t('video')}</Text>
                  </View>
                ) : (
                  <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" />
                )}
                <TouchableOpacity onPress={clearImage} style={styles.clearMediaBtn}>
                  <Text style={{ color: '#c62828' }}>{t('remove')}</Text>
                </TouchableOpacity>
              </View>
            ) : displayRemoteUri ? (
              <View style={styles.mediaBox}>
                {isRemoteVideo ? (
                  <View style={[styles.preview, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#111' }]}>
                    <Text style={{ color: '#fff' }}>📹 {t('video')}</Text>
                  </View>
                ) : (
                  <Image source={{ uri: displayRemoteUri }} style={styles.preview} resizeMode="cover" />
                )}
                <Text style={[styles.hint, { color: colors.textGray }]}>{t('replaceMediaHint')}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.pickBtn, { borderColor: colors.border, backgroundColor: colors.background }]}
              onPress={openMediaPicker}
            >
              <Text style={{ color: colors.primary, fontWeight: '600' }}>
                {showNewLocal || displayRemoteUri ? t('changeMedia') : t('addPhotoOrVideo')}
              </Text>
            </TouchableOpacity>
          </ScrollView>
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
    maxHeight: '88%',
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
  scroll: {
    maxHeight: 520,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  input: {
    marginTop: 12,
    minHeight: 120,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  counter: {
    marginTop: 8,
    fontSize: 12,
    textAlign: 'right',
  },
  sectionLabel: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '600',
  },
  mediaBox: {
    marginTop: 8,
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#111',
  },
  clearMediaBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
  },
  pickBtn: {
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
  },
});

export default EditPostModal;
