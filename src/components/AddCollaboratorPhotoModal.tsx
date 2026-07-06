import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Image,
  Alert,
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useImagePicker } from '../hooks/useImagePicker';
import { useUser } from '../context/UserContext';
import { getMyCollaboratorImage } from '../utils/postCarousel';

type Props = {
  visible: boolean;
  onClose: () => void;
  post: any;
  onSaved: (updated: any) => void;
};

const AddCollaboratorPhotoModal: React.FC<Props> = ({ visible, onClose, post, onSaved }) => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const { user } = useUser();
  const showToast = useShowToast();
  const [saving, setSaving] = useState(false);
  const { imageUri, imageData, pickImage, clearImage } = useImagePicker();
  const currentUserId = user?._id != null ? String(user._id) : '';
  const hasExistingPhoto = !!getMyCollaboratorImage(post, currentUserId);

  useEffect(() => {
    if (visible) clearImage();
  }, [visible, post?._id]);

  const openPicker = () => {
    Alert.alert(t('selectPhoto'), t('collaborativePhotoHint'), [
      { text: t('camera'), onPress: () => pickImage(true) },
      { text: t('galleryPhotosOnly'), onPress: () => pickImage(false) },
      { text: t('cancel'), style: 'cancel' },
    ]);
  };

  const handleSave = async () => {
    if (!post?._id || !imageUri || !imageData) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }
    if (imageData.type?.startsWith('video/')) {
      showToast(t('error'), t('collaborativePhotoImagesOnly'), 'error');
      return;
    }

    setSaving(true);
    try {
      const formData = new FormData();
      const mime = imageData.type || 'image/jpeg';
      formData.append('file', {
        uri: imageUri,
        type: mime,
        name: imageData.fileName || `photo_${Date.now()}.jpg`,
      } as any);

      const data = await apiService.upload(
        `${ENDPOINTS.COLLABORATOR_IMAGE}/${post._id}/contributor-image`,
        formData,
        'PUT',
      );
      const updated = data?.post ?? data;
      if (updated?._id) {
        showToast(t('success'), t('photoAdded'), 'success');
        onSaved(updated);
        onClose();
      } else {
        showToast(t('error'), t('failedToUploadPhoto'), 'error');
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToUploadPhoto'), 'error');
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
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            {hasExistingPhoto ? t('changeYourPhoto') : t('addYourPhoto')}
          </Text>
          <Text style={[styles.hint, { color: colors.textGray }]}>{t('collaborativePhotoHint')}</Text>

          <TouchableOpacity
            style={[styles.pickBtn, { borderColor: colors.border }]}
            onPress={openPicker}
            disabled={saving}
          >
            <Text style={{ color: colors.primary }}>{imageUri ? t('changeYourPhoto') : t('selectPhoto')}</Text>
          </TouchableOpacity>

          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="contain" />
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={saving}>
              <Text style={{ color: colors.textGray }}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving ? 0.7 : 1 }]}
              onPress={handleSave}
              disabled={saving || !imageUri}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.saveBtnText}>{t('post')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    padding: 20,
    paddingBottom: 28,
  },
  title: { fontSize: 18, fontWeight: '700', marginBottom: 6 },
  hint: { fontSize: 14, marginBottom: 16, lineHeight: 20 },
  pickBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 12,
  },
  preview: {
    width: '100%',
    height: 220,
    borderRadius: 10,
    backgroundColor: '#111',
    marginBottom: 16,
  },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 16, alignItems: 'center' },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 8 },
  saveBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, minWidth: 88, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});

export default AddCollaboratorPhotoModal;
