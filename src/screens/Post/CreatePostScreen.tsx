import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
  Modal,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  useWindowDimensions,
  PanResponder,
  LayoutChangeEvent,
} from 'react-native';
import CollaboratorPickerModal from '../../components/CollaboratorPickerModal';
import {
  buildInitialContributorIds,
  CollaboratorUser,
} from '../../utils/collaborators';
import { useUser } from '../../context/UserContext';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useImagePicker, MAX_CAROUSEL_PHOTOS } from '../../hooks/useImagePicker';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import {
  isVideoWithinMaxDuration,
  isAudioWithinMaxDuration,
  MAX_POST_VIDEO_DURATION_SEC,
  MAX_POST_AUDIO_DURATION_SEC,
} from '../../utils/videoDuration';

const MAX_CHAR = 500;
const PREVIEW_ZOOM_MIN = 1;
const PREVIEW_ZOOM_MAX = 3;
const PREVIEW_ZOOM_STEP = 0.12;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const CreatePostScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const showToast = useShowToast();
  const {
    imageUri,
    imageData,
    isVideo,
    carouselImages,
    audioFile,
    pickImage,
    pickMixedFromGallery,
    pickVideoFromCamera,
    pickMultiplePhotos,
    pickAudioFile,
    removeCarouselImage,
    clearCarousel,
    clearAudio,
    clearImage,
    clearAllMedia,
  } = useImagePicker();
  const { t, isRTL } = useLanguage();
  const { colors } = useTheme();
  const { width: winW } = useWindowDimensions();

  const imagePreviewHeight = useMemo(() => {
    const w = imageData?.width;
    const h = imageData?.height;
    const frameW = Math.max(200, winW - 60);
    if (!w || !h || w <= 0 || h <= 0) return 220;
    const computed = Math.round(frameW * (h / w));
    return Math.min(320, Math.max(180, computed));
  }, [imageData?.width, imageData?.height, winW]);

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCollaborative, setIsCollaborative] = useState(false);
  const [selectedCollaborators, setSelectedCollaborators] = useState<CollaboratorUser[]>([]);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [collaboratorModalOpen, setCollaboratorModalOpen] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [previewVpSize, setPreviewVpSize] = useState({ w: 0, h: 0 });

  const previewZoomRef = useRef(1);
  const previewVpRef = useRef({ w: 0, h: 0 });
  const previewPanRef = useRef({ x: 0, y: 0 });
  const previewPanStartRef = useRef({ x: 0, y: 0 });

  previewZoomRef.current = previewZoom;
  previewVpRef.current = previewVpSize;
  previewPanRef.current = previewPan;

  useEffect(() => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  }, [imageUri]);

  const maxPreviewPan = useCallback((z: number, w: number, h: number) => ({
    x: (w * (z - 1)) / 2,
    y: (h * (z - 1)) / 2,
  }), []);

  const clampPreviewPan = useCallback((x: number, y: number, z: number, w: number, h: number) => {
    const m = maxPreviewPan(z, w, h);
    return { x: clamp(x, -m.x, m.x), y: clamp(y, -m.y, m.y) };
  }, [maxPreviewPan]);

  useEffect(() => {
    if (previewZoom <= 1) {
      setPreviewPan({ x: 0, y: 0 });
    } else {
      setPreviewPan((p) => clampPreviewPan(p.x, p.y, previewZoom, previewVpSize.w, previewVpSize.h));
    }
  }, [previewZoom, previewVpSize.w, previewVpSize.h, clampPreviewPan]);

  const onPreviewViewportLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) {
      setPreviewVpSize({ w: width, h: height });
    }
  }, []);

  const previewPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => previewZoomRef.current > 1,
        onMoveShouldSetPanResponder: (_, g) =>
          previewZoomRef.current > 1 && (Math.abs(g.dx) > 4 || Math.abs(g.dy) > 4),
        onPanResponderGrant: () => {
          previewPanStartRef.current = { ...previewPanRef.current };
        },
        onPanResponderMove: (_, g) => {
          const z = previewZoomRef.current;
          const { w, h } = previewVpRef.current;
          setPreviewPan(
            clampPreviewPan(
              previewPanStartRef.current.x + g.dx,
              previewPanStartRef.current.y + g.dy,
              z,
              w,
              h,
            ),
          );
        },
      }),
    [clampPreviewPan],
  );

  const zoomPreviewIn = useCallback(() => {
    setPreviewZoom((z) => clamp(Number((z + PREVIEW_ZOOM_STEP).toFixed(2)), PREVIEW_ZOOM_MIN, PREVIEW_ZOOM_MAX));
  }, []);

  const zoomPreviewOut = useCallback(() => {
    setPreviewZoom((z) => clamp(Number((z - PREVIEW_ZOOM_STEP).toFixed(2)), PREVIEW_ZOOM_MIN, PREVIEW_ZOOM_MAX));
  }, []);

  const resetPreviewZoom = useCallback(() => {
    setPreviewZoom(1);
    setPreviewPan({ x: 0, y: 0 });
  }, []);

  const handleTextChange = (input: string) => {
    if (input.length > MAX_CHAR) {
      setText(input.slice(0, MAX_CHAR));
      return;
    }
    setText(input);
  };

  const handleMediaPick = () => setMediaPickerOpen(true);

  const closeMediaPicker = () => setMediaPickerOpen(false);

  /** Run picker after modal closes so the system picker is not obscured (Android). */
  const runAfterPickerClose = (fn: () => void | Promise<unknown>) => {
    closeMediaPicker();
    setTimeout(() => {
      void fn();
    }, 280);
  };

  const [carouselPreviewIndex, setCarouselPreviewIndex] = useState(0);

  /** Collaborative = one photo per person — no multi-image carousel (owner may add MP3). */
  const clearCollaborativeIncompatibleMedia = useCallback(() => {
    clearCarousel();
    if (isVideo) clearImage();
  }, [clearCarousel, clearImage, isVideo]);

  const activateCollaborative = () => {
    const hadExtra = carouselImages.length > 0 || isVideo;
    if (hadExtra) clearCollaborativeIncompatibleMedia();
    setIsCollaborative(true);
    setCollaboratorModalOpen(true);
    if (hadExtra) {
      showToast(t('info'), t('collaborativeMediaCleared'), 'info');
    }
  };

  const hasMedia =
    !!imageUri ||
    !!audioFile ||
    (!isCollaborative && carouselImages.length > 0);

  const handlePost = async () => {
    if (!text.trim() && !hasMedia) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }

    // Dismiss keyboard immediately when Post button is pressed
    Keyboard.dismiss();

    if (isVideo && imageData && !isVideoWithinMaxDuration(imageData, MAX_POST_VIDEO_DURATION_SEC)) {
      showToast(t('error'), t('postVideoTooLongBody'), 'error');
      return;
    }

    if (isCollaborative) {
      if (isVideo) {
        showToast(t('error'), t('collaborativePhotoImagesOnly'), 'error');
        return;
      }
      if (carouselImages.length > 0) {
        showToast(t('error'), t('collaborativeNoCarousel'), 'error');
        return;
      }
    }

    if (audioFile) {
      const ok = await isAudioWithinMaxDuration(audioFile.uri, MAX_POST_AUDIO_DURATION_SEC);
      if (!ok) {
        showToast(t('error'), t('postAudioTooLongBody'), 'error');
        return;
      }
    }

    setLoading(true);
    try {
      if (carouselImages.length > 0 && !isCollaborative) {
        const formData = new FormData();
        formData.append('text', text.trim() || '');
        formData.append('postedBy', user?._id || '');
        if (isCollaborative) {
          formData.append('isCollaborative', 'true');
          formData.append(
            'contributors',
            JSON.stringify(buildInitialContributorIds(user?._id, selectedCollaborators))
          );
        }
        for (const asset of carouselImages) {
          const mime = asset.type || 'image/jpeg';
          formData.append('images', {
            uri: asset.uri,
            type: mime,
            name: asset.fileName || `image_${Date.now()}.jpg`,
          } as any);
        }
        if (audioFile) {
          formData.append('audio', {
            uri: audioFile.uri,
            type: audioFile.type || 'audio/mpeg',
            name: audioFile.fileName || `audio_${Date.now()}.mp3`,
          } as any);
        }
        const response = await apiService.upload(ENDPOINTS.CREATE_POST, formData);
        const postData = response.post || response;
        if (postData?._id) {
          showToast(t('success'), t('postCreatedSuccessfully'), 'success');
          setText('');
          clearAllMedia();
          setIsCollaborative(false);
          setSelectedCollaborators([]);
          setCarouselPreviewIndex(0);
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        } else {
          showToast(t('error'), t('postCreatedButResponseInvalid'), 'error');
        }
      } else if (imageUri && imageData) {
        const formData = new FormData();
        formData.append('text', text.trim() || '');
        formData.append('postedBy', user?._id || '');
        // Match web: only send collaborative flags when enabled (avoids string "false" being truthy on the server)
        if (isCollaborative) {
          formData.append('isCollaborative', 'true');
          formData.append(
            'contributors',
            JSON.stringify(buildInitialContributorIds(user?._id, selectedCollaborators))
          );
        }

        const mime =
          imageData?.type ||
          (isVideo ? 'video/mp4' : 'image/jpeg');
        const fallbackExt = mime.includes('video') ? 'mp4' : 'jpg';
        const imageFile = {
          uri: imageUri,
          type: mime,
          name:
            imageData?.fileName ||
            (isVideo ? `video_${Date.now()}.${fallbackExt}` : `image_${Date.now()}.${fallbackExt}`),
        };

        formData.append('file', imageFile as any);

        if (audioFile) {
          formData.append('audio', {
            uri: audioFile.uri,
            type: audioFile.type || 'audio/mpeg',
            name: audioFile.fileName || `audio_${Date.now()}.mp3`,
          } as any);
        }

        const response = await apiService.upload(ENDPOINTS.CREATE_POST, formData);
        console.log('📝 [CreatePost] Upload response:', response);
        
        // Backend returns { message: '...', post: { _id: '...', ... } }
        const postData = response.post || response;
        
        if (postData && postData._id) {
          // Don't add own posts to feed - feed only shows posts from users you follow
          // The post will appear in feed after refresh when backend filters correctly
          // addPost(postData); // Removed - feed shouldn't show own posts
          showToast(t('success'), t('postCreatedSuccessfully'), 'success');
          
          // Clear inputs immediately after successful post
          console.log('🧹 [CreatePost] Clearing form - text, image, collaborative');
          setText('');
          clearAllMedia();
          setIsCollaborative(false);
          setSelectedCollaborators([]);
          setCarouselPreviewIndex(0);

          // Force a small delay to ensure UI updates
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        } else {
          console.warn('⚠️ [CreatePost] Response missing _id:', response);
          showToast(t('error'), t('postCreatedButResponseInvalid'), 'error');
        }
      } else {
        const postData: any = {
          text: text.trim(),
          postedBy: user?._id,
        };
        if (isCollaborative) {
          postData.isCollaborative = true;
          postData.contributors = buildInitialContributorIds(user?._id, selectedCollaborators);
        }
        const response = await apiService.post(ENDPOINTS.CREATE_POST, postData);
        console.log('📝 [CreatePost] Post response:', response);
        
        // Backend returns { message: '...', post: { _id: '...', ... } }
        const postDataFromResponse = response.post || response;
        
        if (postDataFromResponse && postDataFromResponse._id) {
          showToast(t('success'), t('postCreatedSuccessfully'), 'success');
          
          setText('');
          clearAllMedia();
          setIsCollaborative(false);
          setSelectedCollaborators([]);
          setCarouselPreviewIndex(0);

          // Force a small delay to ensure UI updates
          await new Promise<void>((resolve) => setTimeout(resolve, 50));
        } else {
          console.warn('⚠️ [CreatePost] Response missing _id:', response);
          showToast(t('error'), t('postCreatedButResponseInvalid'), 'error');
        }
      }
    } catch (error: any) {
      console.error('Error creating post:', error);
      showToast(t('error'), error.message || t('failedToCreatePost'), 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View
        style={[
          styles.header,
          { backgroundColor: colors.backgroundLight, borderBottomColor: colors.border },
        ]}
      >
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.cancelButton, { color: colors.textGray }]}>{t('cancel')}</Text>
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>{t('createPost')}</Text>
        <TouchableOpacity 
          onPress={handlePost}
          disabled={loading || (!text.trim() && !hasMedia)}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text 
              style={[
                styles.postButton,
                { color: colors.primary },
                (!text.trim() && !hasMedia) && styles.postButtonDisabled
              ]}
            >
              {t('post')}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        style={[styles.content, { backgroundColor: colors.background }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.userInfo}>
          {user?.profilePic ? (
            <Image source={{ uri: user.profilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.avatarBg }]}>
              <Text style={styles.avatarText}>
                {user?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.userDetails}>
            <Text style={[styles.userName, { color: colors.text }]} numberOfLines={1}>
              {user?.name}
            </Text>
            <Text style={[styles.userUsername, { color: colors.textGray }]} numberOfLines={1}>
              @{user?.username}
            </Text>
          </View>
          <Text
            style={[
              styles.charCounter,
              {
                color:
                  text.length >= MAX_CHAR ? colors.error : colors.textGray,
              },
            ]}
          >
            {text.length}/{MAX_CHAR}
          </Text>
        </View>

        <TextInput
          style={[styles.textInput, { color: colors.text }]}
          placeholder={t('whatsOnYourMind')}
          placeholderTextColor={colors.textGray}
          value={text}
          onChangeText={handleTextChange}
          maxLength={MAX_CHAR}
          multiline
        />

        {carouselImages.length > 0 && !isCollaborative && (
          <View style={[styles.carouselPreviewWrap, { backgroundColor: colors.backgroundLight }]}>
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false}>
              {carouselImages.map((asset, idx) => (
                <View key={`${asset.uri}-${idx}`} style={{ width: winW - 30, height: imagePreviewHeight }}>
                  <Image source={{ uri: asset.uri! }} style={styles.imageFill} resizeMode="contain" />
                  <TouchableOpacity
                    style={styles.removeImageButton}
                    onPress={() => removeCarouselImage(idx)}
                  >
                    <Text style={styles.removeImageText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
            <Text style={[styles.carouselCountLabel, { color: colors.textGray }]}>
              {carouselImages.length}/{MAX_CAROUSEL_PHOTOS} {t('photos')}
            </Text>
            {audioFile ? (
              <View style={[styles.audioChip, { borderColor: colors.border }]}>
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                  🎵 {audioFile.fileName}
                </Text>
                <TouchableOpacity onPress={clearAudio} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ color: colors.error, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addMusicBtn, { borderColor: colors.primary }]}
                onPress={() => pickAudioFile()}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>+ {t('addMusic')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {imageUri && !isVideo && !carouselImages.length && (
          <View
            style={[
              styles.imageContainer,
              { height: imagePreviewHeight, backgroundColor: colors.backgroundLight },
            ]}
          >
            <View style={styles.imageViewport} onLayout={onPreviewViewportLayout}>
              <Image
                source={{ uri: imageUri }}
                style={[
                  styles.imageFill,
                  previewZoom > 1 && {
                    transform: [
                      { translateX: previewPan.x },
                      { translateY: previewPan.y },
                      { scale: previewZoom },
                    ],
                  },
                ]}
                resizeMode="contain"
              />
              {previewZoom > 1 && (
                <View style={styles.previewDragOverlay} {...previewPanResponder.panHandlers} />
              )}
            </View>

            <View style={styles.previewZoomControls} pointerEvents="box-none">
              <TouchableOpacity
                style={styles.previewZoomChip}
                onPress={zoomPreviewOut}
                disabled={previewZoom <= PREVIEW_ZOOM_MIN}
              >
                <Text
                  style={[
                    styles.previewZoomChipText,
                    previewZoom <= PREVIEW_ZOOM_MIN && styles.previewZoomChipDisabled,
                  ]}
                >
                  −
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.previewZoomChip} onPress={resetPreviewZoom}>
                <Text style={[styles.previewZoomChipText, styles.previewZoomPct]}>
                  {Math.round(previewZoom * 100)}%
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.previewZoomChip}
                onPress={zoomPreviewIn}
                disabled={previewZoom >= PREVIEW_ZOOM_MAX}
              >
                <Text
                  style={[
                    styles.previewZoomChipText,
                    previewZoom >= PREVIEW_ZOOM_MAX && styles.previewZoomChipDisabled,
                  ]}
                >
                  +
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.removeImageButton}
              onPress={clearAllMedia}
            >
              <Text style={styles.removeImageText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {isCollaborative && imageUri && !isVideo && !carouselImages.length ? (
          <View style={styles.collabAudioWrap}>
            {audioFile ? (
              <View style={[styles.audioChip, { borderColor: colors.border }]}>
                <Text style={{ color: colors.text, flex: 1 }} numberOfLines={1}>
                  🎵 {audioFile.fileName}
                </Text>
                <TouchableOpacity onPress={clearAudio} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={{ color: colors.error, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.addMusicBtn, { borderColor: colors.primary }]}
                onPress={() => pickAudioFile()}
              >
                <Text style={{ color: colors.primary, fontWeight: '600' }}>+ {t('addMusic')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : null}

        {imageUri && isVideo && !carouselImages.length && (
          <View style={styles.imageContainer}>
            <View style={styles.videoPreview}>
              <Text style={styles.videoPreviewIcon}>🎬</Text>
              <Text style={styles.videoPreviewText}>{t('videoSelected')}</Text>
              {!!imageData?.duration && imageData.duration > 0 && (
                <Text style={styles.videoPreviewMeta}>
                  {Math.round(imageData.duration)}s
                </Text>
              )}
            </View>
            <TouchableOpacity
              style={styles.removeImageButton}
              onPress={clearAllMedia}
            >
              <Text style={styles.removeImageText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.options}>
          <TouchableOpacity
            style={styles.option}
            onPress={() => {
              if (!isCollaborative) {
                activateCollaborative();
              } else {
                setCollaboratorModalOpen(true);
              }
            }}
            onLongPress={() => {
              if (isCollaborative) {
                setIsCollaborative(false);
                setSelectedCollaborators([]);
                setCollaboratorModalOpen(false);
              }
            }}
            delayLongPress={450}
          >
            <Text
              style={[styles.optionIcon, { color: colors.success }]}
              allowFontScaling={false}
              {...(Platform.OS === 'android' ? { includeFontPadding: false } : {})}
            >
              {isCollaborative ? '✅' : '☑️'}
            </Text>
            <Text style={[styles.optionText, { color: colors.text }]}>
              {t('collaborativePost')}
              {isCollaborative && selectedCollaborators.length > 0
                ? ` (${selectedCollaborators.length})`
                : ''}
            </Text>
          </TouchableOpacity>
          {isCollaborative ? (
            <Text style={[styles.collabCreateHint, { color: colors.textGray }]}>
              {t('collaborativeCreateHint')}
            </Text>
          ) : null}
        </View>
      </ScrollView>

      <View
        style={[
          styles.toolbar,
          { backgroundColor: colors.backgroundLight, borderTopColor: colors.border },
        ]}
      >
        <TouchableOpacity style={styles.toolbarButton} onPress={handleMediaPick}>
          <Text style={styles.toolbarIcon}>🖼️</Text>
        </TouchableOpacity>
      </View>

      <CollaboratorPickerModal
        visible={collaboratorModalOpen}
        onClose={() => setCollaboratorModalOpen(false)}
        excludeUserIds={[user?._id?.toString()].filter(Boolean) as string[]}
        selectedCollaborators={selectedCollaborators}
        onChangeSelected={setSelectedCollaborators}
      />

      <Modal
        visible={mediaPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={closeMediaPicker}
      >
        <Pressable style={styles.mediaModalBackdrop} onPress={closeMediaPicker}>
          <Pressable
            style={[styles.mediaModalCard, { backgroundColor: colors.backgroundLight }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Text style={[styles.mediaModalTitle, { color: colors.text }, isRTL && styles.rtlText]}>
              {t(isCollaborative ? 'selectPhoto' : 'selectMedia')}
            </Text>
            <Text style={[styles.mediaModalSubtitle, { color: colors.textGray }, isRTL && styles.rtlText]}>
              {isCollaborative ? t('collaborativePhotoHint') : t('chooseOption')}
            </Text>

            {!isCollaborative ? (
            <TouchableOpacity
              style={[styles.mediaModalOption, { alignItems: isRTL ? 'flex-start' : 'flex-end' }]}
              onPress={() => runAfterPickerClose(() => pickMultiplePhotos())}
              activeOpacity={0.7}
            >
              <Text style={[styles.mediaModalOptionText, { color: colors.primary }, isRTL && styles.rtlText]}>
                {t('carouselPhotos').toUpperCase()}
              </Text>
            </TouchableOpacity>
            ) : null}

            {!isCollaborative ? (
            <TouchableOpacity
              style={[styles.mediaModalOption, { alignItems: isRTL ? 'flex-start' : 'flex-end' }]}
              onPress={() => runAfterPickerClose(() => pickVideoFromCamera())}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.mediaModalOptionText,
                  { color: colors.primary },
                  isRTL && styles.rtlText,
                ]}
              >
                {isRTL ? t('recordVideo') : t('recordVideo').toUpperCase()}
              </Text>
            </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.mediaModalOption, { alignItems: isRTL ? 'flex-start' : 'flex-end' }]}
              onPress={() =>
                runAfterPickerClose(() =>
                  isCollaborative ? pickImage(false) : pickMixedFromGallery(),
                )
              }
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.mediaModalOptionText,
                  { color: colors.primary },
                  isRTL && styles.rtlText,
                ]}
              >
                {isCollaborative
                  ? isRTL
                    ? t('galleryPhotosOnly')
                    : t('galleryPhotosOnly').toUpperCase()
                  : isRTL
                    ? t('gallery')
                    : t('gallery').toUpperCase()}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.mediaModalOption, { alignItems: isRTL ? 'flex-start' : 'flex-end' }]}
              onPress={() => runAfterPickerClose(() => pickImage(true))}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.mediaModalOptionText,
                  { color: colors.primary },
                  isRTL && styles.rtlText,
                ]}
              >
                {isRTL ? t('camera') : t('camera').toUpperCase()}
              </Text>
            </TouchableOpacity>

            <View style={[styles.mediaModalDivider, { backgroundColor: colors.border }]} />

            <TouchableOpacity
              style={styles.mediaModalCancel}
              onPress={closeMediaPicker}
              activeOpacity={0.7}
            >
              <Text style={[styles.mediaModalCancelText, { color: colors.text }]}>{t('cancel')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
  },
  cancelButton: {
    fontSize: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  postButton: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  postButtonDisabled: {
    opacity: 0.4,
  },
  content: {
    flex: 1,
    padding: 15,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 15,
    direction: 'ltr',
  },
  charCounter: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    marginLeft: 8,
    flexShrink: 0,
    textAlign: 'right',
  },
  avatar: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    marginRight: 10,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  userDetails: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-start',
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
    textAlign: 'left',
    alignSelf: 'stretch',
    writingDirection: 'ltr',
  },
  userUsername: {
    fontSize: 14,
    textAlign: 'left',
    alignSelf: 'stretch',
    writingDirection: 'ltr',
  },
  textInput: {
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  imageContainer: {
    marginTop: 15,
    position: 'relative',
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageViewport: {
    flex: 1,
    overflow: 'hidden',
  },
  imageFill: {
    width: '100%',
    height: '100%',
  },
  previewDragOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 5,
  },
  previewZoomControls: {
    position: 'absolute',
    right: 8,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
    zIndex: 20,
  },
  previewZoomChip: {
    minWidth: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  previewZoomChipText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  previewZoomPct: {
    fontSize: 11,
  },
  previewZoomChipDisabled: {
    opacity: 0.35,
  },
  videoPreview: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoPreviewIcon: {
    fontSize: 42,
    marginBottom: 8,
  },
  videoPreviewText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  videoPreviewMeta: {
    color: '#94A3B8',
    fontSize: 14,
    marginTop: 6,
  },
  removeImageButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 25,
  },
  removeImageText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  carouselPreviewWrap: {
    marginTop: 15,
    borderRadius: 12,
    overflow: 'hidden',
  },
  carouselCountLabel: {
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlign: 'center',
  },
  audioChip: {
    marginTop: 8,
    marginHorizontal: 10,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  addMusicBtn: {
    marginTop: 4,
    marginHorizontal: 10,
    marginBottom: 10,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  collabAudioWrap: {
    marginTop: 4,
    marginBottom: 4,
  },
  options: {
    marginTop: 20,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  optionIcon: {
    fontSize: 20,
    lineHeight: 22,
    marginRight: 4,
  },
  optionText: {
    fontSize: 16,
  },
  collabCreateHint: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    marginBottom: 4,
    paddingHorizontal: 2,
  },
  toolbar: {
    flexDirection: 'row',
    padding: 15,
    borderTopWidth: 1,
  },
  toolbarButton: {
    marginRight: 15,
  },
  toolbarIcon: {
    fontSize: 24,
  },
  mediaModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  mediaModalCard: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 14,
    paddingTop: 20,
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  mediaModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  mediaModalSubtitle: {
    fontSize: 14,
    marginBottom: 16,
  },
  rtlText: {
    writingDirection: 'rtl',
    textAlign: 'right',
    alignSelf: 'stretch',
  },
  mediaModalOption: {
    paddingVertical: 14,
  },
  mediaModalOptionText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  mediaModalDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 4,
  },
  mediaModalCancel: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  mediaModalCancelText: {
    fontSize: 16,
    fontWeight: '600',
  },
});

export default CreatePostScreen;
