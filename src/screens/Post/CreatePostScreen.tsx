import React, { useState } from 'react';
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
import { useImagePicker } from '../../hooks/useImagePicker';
import { useLanguage } from '../../context/LanguageContext';
import { useTheme } from '../../context/ThemeContext';
import {
  isVideoWithinMaxDuration,
  MAX_POST_VIDEO_DURATION_SEC,
} from '../../utils/videoDuration';

const MAX_CHAR = 500;

const CreatePostScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const showToast = useShowToast();
  const {
    imageUri,
    imageData,
    isVideo,
    pickImage,
    pickMixedFromGallery,
    pickVideoFromCamera,
    clearImage,
  } = useImagePicker();
  const { t, isRTL } = useLanguage();
  const { colors } = useTheme();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCollaborative, setIsCollaborative] = useState(false);
  const [selectedCollaborators, setSelectedCollaborators] = useState<CollaboratorUser[]>([]);
  const [mediaPickerOpen, setMediaPickerOpen] = useState(false);
  const [collaboratorModalOpen, setCollaboratorModalOpen] = useState(false);

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

  const handlePost = async () => {
    if (!text.trim() && !imageUri) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }

    // Dismiss keyboard immediately when Post button is pressed
    Keyboard.dismiss();

    if (isVideo && imageData && !isVideoWithinMaxDuration(imageData, MAX_POST_VIDEO_DURATION_SEC)) {
      showToast(t('error'), t('postVideoTooLongBody'), 'error');
      return;
    }

    setLoading(true);
    try {
      if (imageUri && imageData) {
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
          clearImage();
          setIsCollaborative(false);
          setSelectedCollaborators([]);

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
          // Don't add own posts to feed - feed only shows posts from users you follow
          // The post will appear in feed after refresh when backend filters correctly
          // addPost(postDataFromResponse); // Removed - feed shouldn't show own posts
          showToast(t('success'), t('postCreatedSuccessfully'), 'success');
          
          // Clear inputs immediately after successful post
          console.log('🧹 [CreatePost] Clearing form - text, image, collaborative');
          setText('');
          clearImage(); // Clear image even if not used (in case user removed it)
          setIsCollaborative(false);
          setSelectedCollaborators([]);

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
          disabled={loading || (!text.trim() && !imageUri)}
        >
          {loading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text 
              style={[
                styles.postButton,
                { color: colors.primary },
                (!text.trim() && !imageUri) && styles.postButtonDisabled
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
            <Text style={[styles.userName, { color: colors.text }]}>{user?.name}</Text>
            <Text style={[styles.userUsername, { color: colors.textGray }]}>@{user?.username}</Text>
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
          autoFocus
        />

        {imageUri && !isVideo && (
          <View style={styles.imageContainer}>
            <Image source={{ uri: imageUri }} style={styles.image} />
            <TouchableOpacity
              style={styles.removeImageButton}
              onPress={clearImage}
            >
              <Text style={styles.removeImageText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}
        {imageUri && isVideo && (
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
              onPress={clearImage}
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
                setIsCollaborative(true);
                setCollaboratorModalOpen(true);
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
              {t('selectMedia')}
            </Text>
            <Text style={[styles.mediaModalSubtitle, { color: colors.textGray }, isRTL && styles.rtlText]}>
              {t('chooseOption')}
            </Text>

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
            <TouchableOpacity
              style={[styles.mediaModalOption, { alignItems: isRTL ? 'flex-start' : 'flex-end' }]}
              onPress={() => runAfterPickerClose(() => pickMixedFromGallery())}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.mediaModalOptionText,
                  { color: colors.primary },
                  isRTL && styles.rtlText,
                ]}
              >
                {isRTL ? t('gallery') : t('gallery').toUpperCase()}
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
  },
  charCounter: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
    marginLeft: 8,
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
  },
  userName: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  userUsername: {
    fontSize: 14,
  },
  textInput: {
    fontSize: 16,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  imageContainer: {
    marginTop: 15,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: 200,
    borderRadius: 12,
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
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  removeImageText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
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
