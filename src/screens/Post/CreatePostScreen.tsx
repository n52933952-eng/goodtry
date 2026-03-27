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
  Alert,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
} from 'react-native';
import CollaboratorPicker from '../../components/CollaboratorPicker';
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
  const { t } = useLanguage();
  const { colors } = useTheme();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCollaborative, setIsCollaborative] = useState(false);
  const [selectedCollaborators, setSelectedCollaborators] = useState<CollaboratorUser[]>([]);

  const handleMediaPick = () => {
    Alert.alert(
      t('selectMedia'),
      t('chooseOption'),
      [
        { text: t('camera'), onPress: () => pickImage(true) },
        { text: t('gallery'), onPress: () => pickMixedFromGallery() },
        { text: t('recordVideo'), onPress: () => pickVideoFromCamera() },
        { text: t('cancel'), style: 'cancel' },
      ]
    );
  };

  const handlePost = async () => {
    if (!text.trim() && !imageUri) {
      showToast(t('error'), t('pleaseAddTextOrImage'), 'error');
      return;
    }

    // Dismiss keyboard immediately when Post button is pressed
    Keyboard.dismiss();

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
        </View>

        <TextInput
          style={[styles.textInput, { color: colors.text }]}
          placeholder={t('whatsOnYourMind')}
          placeholderTextColor={colors.textGray}
          value={text}
          onChangeText={setText}
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
              const next = !isCollaborative;
              setIsCollaborative(next);
              if (!next) setSelectedCollaborators([]);
            }}
          >
            <Text style={styles.optionIcon}>
              {isCollaborative ? '✅' : '☑️'}
            </Text>
            <Text style={[styles.optionText, { color: colors.text }]}>{t('collaborativePost')}</Text>
          </TouchableOpacity>
        </View>

        {isCollaborative && (
          <View style={styles.collabSection}>
            <Text style={[styles.collabHint, { color: colors.textGray }]}>{t('addContributors')}</Text>
            <CollaboratorPicker
              excludeUserIds={[
                user?._id?.toString(),
                ...selectedCollaborators.map((s) => String(s._id)),
              ].filter(Boolean) as string[]}
              onSelectUser={(u) => {
                if (!selectedCollaborators.some((x) => x._id === u._id)) {
                  setSelectedCollaborators((p) => [...p, u]);
                }
              }}
            />
            {selectedCollaborators.length > 0 && (
              <View style={styles.selectedChips}>
                <Text style={[styles.selectedLabel, { color: colors.textGray }]}>
                  {t('selected')} ({selectedCollaborators.length})
                </Text>
                {selectedCollaborators.map((su) => (
                  <View
                    key={su._id}
                    style={[styles.chipRow, { borderColor: colors.border, backgroundColor: colors.background }]}
                  >
                    <Text style={[styles.chipText, { color: colors.text }]} numberOfLines={1}>
                      {su.name || su.username}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setSelectedCollaborators((p) => p.filter((x) => x._id !== su._id))
                      }
                    >
                      <Text style={{ color: colors.primary }}>{t('remove')}</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}
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
    alignItems: 'center',
    marginBottom: 15,
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
    marginRight: 10,
  },
  optionText: {
    fontSize: 16,
  },
  collabSection: {
    marginTop: 8,
    marginBottom: 8,
  },
  collabHint: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  selectedChips: {
    marginTop: 12,
  },
  selectedLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 6,
  },
  chipText: {
    flex: 1,
    fontSize: 14,
    marginRight: 8,
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
});

export default CreatePostScreen;
