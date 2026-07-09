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
} from 'react-native';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useImagePicker } from '../hooks/useImagePicker';
import { getPostCarouselAudio, isCarouselPost } from '../utils/postCarousel';
import { uploadMediaToR2 } from '../utils/directR2Upload';

type Props = {
  visible: boolean;
  onClose: () => void;
  post: any;
  onSaved: (updated: any) => void;
};

const CollaborativePostAudioModal: React.FC<Props> = ({ visible, onClose, post, onSaved }) => {
  const { t } = useLanguage();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { audioFile, pickAudioFile, clearAudio } = useImagePicker();
  const hasExistingAudio = !!getPostCarouselAudio(post);
  const isCarousel = isCarouselPost(post);

  useEffect(() => {
    if (visible) clearAudio();
  }, [visible, post?._id]);

  const handleSave = async () => {
    if (!post?._id || !audioFile) {
      showToast(t('error'), t('pickAudioFileHint'), 'error');
      return;
    }

    setSaving(true);
    try {
      const audio = await uploadMediaToR2(
        {
          uri: audioFile.uri,
          type: audioFile.type || 'audio/mpeg',
          fileName: audioFile.fileName || `audio_${Date.now()}.mp3`,
          skipCompress: true,
        },
        'posts',
      );

      const data = await apiService.put(
        `${ENDPOINTS.COLLABORATOR_AUDIO}/${post._id}/audio`,
        { audio },
      );
      const updated = data?.post ?? data;
      if (updated?._id) {
        showToast(t('success'), t('musicAdded'), 'success');
        onSaved(updated);
        onClose();
      } else {
        showToast(t('error'), t('failedToPickAudio'), 'error');
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToPickAudio'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!post?._id || !hasExistingAudio) return;

    setRemoving(true);
    try {
      const data = await apiService.delete(`${ENDPOINTS.COLLABORATOR_AUDIO}/${post._id}/audio`);
      const updated = data?.post ?? data;
      if (updated?._id) {
        showToast(t('success'), t('musicRemoved'), 'success');
        onSaved(updated);
        onClose();
      }
    } catch (e: any) {
      showToast(t('error'), e?.message || t('failedToPickAudio'), 'error');
    } finally {
      setRemoving(false);
    }
  };

  const busy = saving || removing;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>
            {hasExistingAudio ? t('changeMusic') : t('addMusic')}
          </Text>
          <Text style={[styles.hint, { color: colors.textGray }]}>
            {isCarousel ? t('carouselOwnerMusicHint') : t('collaborativeOwnerMusicHint')}
          </Text>

          <TouchableOpacity
            style={[styles.pickBtn, { borderColor: colors.border }]}
            onPress={() => pickAudioFile()}
            disabled={busy}
          >
            <Text style={{ color: colors.primary }}>
              {audioFile ? `🎵 ${audioFile.fileName}` : t('pickAudioFileHint')}
            </Text>
          </TouchableOpacity>

          {audioFile ? (
            <TouchableOpacity onPress={clearAudio} disabled={busy}>
              <Text style={{ color: colors.error, marginBottom: 12 }}>{t('remove')}</Text>
            </TouchableOpacity>
          ) : null}

          <View style={styles.actions}>
            {hasExistingAudio ? (
              <TouchableOpacity onPress={handleRemove} disabled={busy}>
                <Text style={{ color: colors.error }}>{t('removeMusic')}</Text>
              </TouchableOpacity>
            ) : (
              <View />
            )}
            <View style={styles.actionRight}>
              <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={busy}>
                <Text style={{ color: colors.textGray }}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: busy || !audioFile ? 0.7 : 1 }]}
                onPress={handleSave}
                disabled={busy || !audioFile}
              >
                {saving ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>{t('save')}</Text>
                )}
              </TouchableOpacity>
            </View>
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
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  actionRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  cancelBtn: { paddingVertical: 10, paddingHorizontal: 8 },
  saveBtn: { paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, minWidth: 88, alignItems: 'center' },
  saveBtnText: { color: '#fff', fontWeight: '700' },
});

export default CollaborativePostAudioModal;
