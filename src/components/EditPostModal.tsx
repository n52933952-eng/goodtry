import React, { useState, useEffect, useCallback } from 'react';
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
  Pressable,
  Keyboard,
} from 'react-native';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';
import { useShowToast } from '../hooks/useShowToast';
import { useImagePicker } from '../hooks/useImagePicker';
import {
  isVideoWithinMaxDuration,
  MAX_POST_VIDEO_DURATION_SEC,
  isVideoAsset,
} from '../utils/videoDuration';
import { isCarouselPost, MAX_POST_CAROUSEL_IMAGES } from '../utils/postCarousel';
import { mediaDisplayUrl } from '../utils/mediaUrl';
import { uploadMediaToR2, uploadManyMediaToR2 } from '../utils/directR2Upload';

const MAX_LEN = 500;

type CarouselEditSlot =
  | { key: string; kind: 'existing'; url: string }
  | { key: string; kind: 'new'; uri: string; mime: string; fileName: string };

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
  const [carouselSlots, setCarouselSlots] = useState<CarouselEditSlot[]>([]);
  const {
    imageUri,
    imageData,
    isVideo,
    pickImage,
    pickMixedFromGallery,
    pickVideoFromCamera,
    clearImage,
  } = useImagePicker();

  const isCollaborative = !!post?.isCollaborative;
  const isCarousel = isCarouselPost(post);
  const captionOnlyEdit = isCollaborative;

  const resetCarouselSlots = useCallback(() => {
    if (!isCarouselPost(post)) {
      setCarouselSlots([]);
      return;
    }
    const urls = Array.isArray(post?.images)
      ? post.images.map(String).filter(Boolean)
      : [];
    setCarouselSlots(
      urls.map((url, index) => ({
        key: `existing-${index}-${url}`,
        kind: 'existing' as const,
        url,
      })),
    );
  }, [post]);

  useEffect(() => {
    if (visible && post) {
      setText(post.text || '');
      clearImage();
      resetCarouselSlots();
    }
  }, [visible, post?._id, post?.text, resetCarouselSlots]);

  const remoteImg = post?.img ? String(post.img) : '';
  const isRemoteVideo =
    !!remoteImg &&
    (/\.(mp4|webm|ogg|mov)$/i.test(remoteImg) || remoteImg.includes('/video/upload/'));
  const hasRemoteMedia = isCarousel
    ? carouselSlots.length > 0
    : !!(remoteImg && !remoteImg.includes('youtube'));
  const displayRemoteUri = remoteImg && !imageUri && !remoteImg.includes('youtube') ? remoteImg : null;
  const showNewLocal = !!imageUri;

  const pickCarouselPhoto = useCallback(
    (onPicked: (asset: Asset) => void) => {
      Alert.alert(t('selectPhoto'), t('carouselEditTextHint'), [
        {
          text: t('camera'),
          onPress: async () => {
            const result = await launchCamera({
              mediaType: 'photo',
              quality: 0.8,
              maxWidth: 1024,
              maxHeight: 1024,
            });
            const asset = result.assets?.[0];
            if (!asset?.uri) return;
            if (isVideoAsset(asset)) {
              showToast(t('error'), t('carouselPhotosOnly'), 'error');
              return;
            }
            onPicked(asset);
          },
        },
        {
          text: t('galleryPhotosOnly'),
          onPress: async () => {
            const result = await launchImageLibrary({
              mediaType: 'photo',
              quality: 0.8,
              maxWidth: 1024,
              maxHeight: 1024,
              selectionLimit: 1,
            });
            const asset = result.assets?.[0];
            if (!asset?.uri) return;
            if (isVideoAsset(asset)) {
              showToast(t('error'), t('carouselPhotosOnly'), 'error');
              return;
            }
            onPicked(asset);
          },
        },
        { text: t('cancel'), style: 'cancel' },
      ]);
    },
    [t, showToast],
  );

  const assetToNewSlot = (asset: Asset): CarouselEditSlot => ({
    key: `new-${Date.now()}-${Math.random()}`,
    kind: 'new',
    uri: asset.uri || '',
    mime: asset.type || 'image/jpeg',
    fileName: asset.fileName || `image_${Date.now()}.jpg`,
  });

  const replaceCarouselSlot = (index: number) => {
    pickCarouselPhoto((asset) => {
      if (!asset.uri) return;
      setCarouselSlots((prev) =>
        prev.map((slot, i) => (i === index ? assetToNewSlot(asset) : slot)),
      );
    });
  };

  const addCarouselSlot = () => {
    if (carouselSlots.length >= MAX_POST_CAROUSEL_IMAGES) {
      showToast(t('error'), t('carouselMaxPhotos'), 'error');
      return;
    }
    pickCarouselPhoto((asset) => {
      if (!asset.uri) return;
      setCarouselSlots((prev) => [...prev, assetToNewSlot(asset)]);
    });
  };

  const removeCarouselSlot = (index: number) => {
    setCarouselSlots((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSave = useCallback(async () => {
    if (!post?._id || saving) return;
    Keyboard.dismiss();
    const trimmed = text.trim();
    const willUploadNew = !captionOnlyEdit && !isCarousel && !!(imageUri && imageData);

    if (!trimmed && !hasRemoteMedia && !willUploadNew) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }
    if (isCarousel && carouselSlots.length === 0 && !trimmed) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }
    if (trimmed.length > MAX_LEN) {
      showToast(t('error'), t('postTextTooLong'), 'error');
      return;
    }

    if (willUploadNew && isVideo && imageData && !isVideoWithinMaxDuration(imageData, MAX_POST_VIDEO_DURATION_SEC)) {
      showToast(t('error'), t('postVideoTooLongBody'), 'error');
      return;
    }

    setSaving(true);
    try {
      if (isCarousel) {
        const newSlots = carouselSlots.filter((s) => s.kind === 'new');
        const uploadedUrls =
          newSlots.length > 0
            ? await uploadManyMediaToR2(
                newSlots.map((s) => ({
                  uri: s.uri,
                  type: s.mime,
                  fileName: s.fileName,
                })),
                'posts',
              )
            : [];
        let newIdx = 0;
        const imageSlots = carouselSlots.map((slot) => {
          if (slot.kind === 'existing') {
            return { kind: 'keep', url: slot.url };
          }
          const url = uploadedUrls[newIdx++];
          return { kind: 'url', url };
        });
        const data = await apiService.put(
          `${ENDPOINTS.CAROUSEL_POST}/${post._id}/images`,
          { text: trimmed, imageSlots },
        );
        const updated = data?.post ?? data;
        if (updated?._id) {
          showToast(t('success'), t('postUpdatedSuccessfully'), 'success');
          onSaved(updated);
          onClose();
        } else {
          showToast(t('error'), t('failedToUpdatePost'), 'error');
        }
      } else if (willUploadNew) {
        const mime =
          imageData?.type || (isVideo ? 'video/mp4' : 'image/jpeg');
        const fallbackExt = mime.includes('video') ? 'mp4' : 'jpg';
        const img = await uploadMediaToR2(
          {
            uri: imageUri!,
            type: mime,
            fileName:
              imageData?.fileName ||
              (isVideo
                ? `video_${Date.now()}.${fallbackExt}`
                : `image_${Date.now()}.${fallbackExt}`),
            skipCompress: !!isVideo,
          },
          'posts',
        );
        const data = await apiService.put(`${ENDPOINTS.UPDATE_POST}/${post._id}`, {
          text: trimmed,
          img,
        });
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
  }, [
    post?._id,
    saving,
    text,
    isCarousel,
    carouselSlots,
    captionOnlyEdit,
    imageUri,
    imageData,
    hasRemoteMedia,
    isVideo,
    showToast,
    t,
    onSaved,
    onClose,
  ]);

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
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.backgroundLight }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={onClose} style={[styles.headerSideBtn, styles.headerSideBtnLeft]}>
              <Text style={{ color: colors.textGray, fontSize: 16 }}>{t('cancel')}</Text>
            </TouchableOpacity>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {t('editPost')}
            </Text>
            <Pressable
              onPressIn={() => {
                if (saving) return;
                Keyboard.dismiss();
                handleSave();
              }}
              disabled={saving}
              style={[styles.headerSideBtn, styles.headerSideBtnRight]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {saving ? (
                <ActivityIndicator color={colors.primary} />
              ) : (
                <Text style={{ color: colors.primary, fontSize: 16, fontWeight: '600' }}>{t('save')}</Text>
              )}
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            keyboardShouldPersistTaps="always"
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
              onChangeText={(input) => {
                if (input.length > MAX_LEN) {
                  setText(input.slice(0, MAX_LEN));
                  return;
                }
                setText(input);
              }}
              placeholder={t('whatsOnYourMind')}
              placeholderTextColor={colors.textGray}
            />
            <Text
              style={[
                styles.counter,
                { color: (text?.length || 0) >= MAX_LEN ? colors.error : colors.textGray },
              ]}
            >
              {text?.length || 0}/{MAX_LEN}
            </Text>

            {isCollaborative ? (
              <Text style={[styles.collabHint, { color: colors.textGray }]}>
                {t('collaborativeEditTextHint')}
              </Text>
            ) : isCarousel ? (
              <>
                <Text style={[styles.sectionLabel, { color: colors.textGray }]}>
                  {t('photos')} ({carouselSlots.length}/{MAX_POST_CAROUSEL_IMAGES})
                </Text>
                <Text style={[styles.collabHint, { color: colors.textGray }]}>
                  {t('carouselEditTextHint')}
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.carouselRow}
                  contentContainerStyle={styles.carouselRowContent}
                >
                  {carouselSlots.map((slot, index) => {
                    const uri =
                      slot.kind === 'existing' ? mediaDisplayUrl(slot.url) : slot.uri;
                    return (
                      <View key={slot.key} style={styles.carouselThumbWrap}>
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => replaceCarouselSlot(index)}
                        >
                          <Image source={{ uri }} style={styles.carouselThumb} resizeMode="cover" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.carouselRemoveBtn}
                          onPress={() => removeCarouselSlot(index)}
                          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                        >
                          <Text style={styles.carouselRemoveText}>✕</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                  {carouselSlots.length < MAX_POST_CAROUSEL_IMAGES ? (
                    <TouchableOpacity
                      style={[styles.carouselAddBtn, { borderColor: colors.border }]}
                      onPress={addCarouselSlot}
                    >
                      <Text style={{ color: colors.primary, fontSize: 28, lineHeight: 30 }}>+</Text>
                    </TouchableOpacity>
                  ) : null}
                </ScrollView>
              </>
            ) : (
              <>
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
              </>
            )}
          </ScrollView>
        </Pressable>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerSideBtn: {
    flex: 1,
    justifyContent: 'center',
  },
  headerSideBtnLeft: {
    alignItems: 'flex-start',
  },
  headerSideBtnRight: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 2,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    marginHorizontal: 8,
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
  collabHint: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
  },
  sectionLabel: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '600',
  },
  carouselRow: {
    marginTop: 12,
    flexGrow: 0,
  },
  carouselRowContent: {
    alignItems: 'center',
    paddingBottom: 4,
  },
  carouselThumbWrap: {
    position: 'relative',
    marginRight: 10,
  },
  carouselThumb: {
    width: 96,
    height: 96,
    borderRadius: 12,
    backgroundColor: '#111',
  },
  carouselRemoveBtn: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselRemoveText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  carouselAddBtn: {
    width: 96,
    height: 96,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
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
