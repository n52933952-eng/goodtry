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
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { usePost } from '../../context/PostContext';
import { apiService } from '../../services/api';
import { ENDPOINTS, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useImagePicker } from '../../hooks/useImagePicker';

const CreatePostScreen = ({ navigation }: any) => {
  const { user } = useUser();
  const { addPost } = usePost();
  const showToast = useShowToast();
  const { imageUri, imageData, pickImage, clearImage } = useImagePicker();

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [isCollaborative, setIsCollaborative] = useState(false);

  const handleImagePick = () => {
    Alert.alert(
      'Select Image',
      'Choose an option',
      [
        { text: 'Camera', onPress: () => pickImage(true) },
        { text: 'Gallery', onPress: () => pickImage(false) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  const handlePost = async () => {
    if (!text.trim() && !imageUri) {
      showToast('Error', 'Please add some text or an image', 'error');
      return;
    }

    setLoading(true);
    try {
      if (imageUri && imageData) {
        const formData = new FormData();
        formData.append('text', text.trim() || '');
        formData.append('postedBy', user?._id || '');
        formData.append('isCollaborative', isCollaborative ? 'true' : 'false');
        
        const imageFile = {
          uri: imageUri,
          type: imageData.type || 'image/jpeg',
          name: imageData.fileName || `image_${Date.now()}.jpg`,
        };
        
        formData.append('file', imageFile as any);

        const response = await apiService.upload(ENDPOINTS.CREATE_POST, formData);
        if (response._id) {
          addPost(response);
          showToast('Success', 'Post created!', 'success');
          setText('');
          clearImage();
          setIsCollaborative(false);
          setTimeout(() => navigation.goBack(), 100);
        }
      } else {
        const postData: any = {
          text: text.trim(),
          postedBy: user?._id,
          isCollaborative,
        };
        const response = await apiService.post(ENDPOINTS.CREATE_POST, postData);
        if (response._id) {
          addPost(response);
          showToast('Success', 'Post created!', 'success');
          setText('');
          setIsCollaborative(false);
          setTimeout(() => navigation.goBack(), 100);
        }
      }
    } catch (error: any) {
      console.error('Error creating post:', error);
      showToast('Error', error.message || 'Failed to create post', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.cancelButton}>Cancel</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Create Post</Text>
        <TouchableOpacity 
          onPress={handlePost}
          disabled={loading || (!text.trim() && !imageUri)}
        >
          {loading ? (
            <ActivityIndicator color={COLORS.primary} />
          ) : (
            <Text 
              style={[
                styles.postButton,
                (!text.trim() && !imageUri) && styles.postButtonDisabled
              ]}
            >
              Post
            </Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.userInfo}>
          {user?.profilePic ? (
            <Image source={{ uri: user.profilePic }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarText}>
                {user?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <View style={styles.userDetails}>
            <Text style={styles.userName}>{user?.name}</Text>
            <Text style={styles.userUsername}>@{user?.username}</Text>
          </View>
        </View>

        <TextInput
          style={styles.textInput}
          placeholder="What's on your mind?"
          placeholderTextColor={COLORS.textGray}
          value={text}
          onChangeText={setText}
          multiline
          autoFocus
        />

        {imageUri && (
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

        <View style={styles.options}>
          <TouchableOpacity
            style={styles.option}
            onPress={() => setIsCollaborative(!isCollaborative)}
          >
            <Text style={styles.optionIcon}>
              {isCollaborative ? '✅' : '☑️'}
            </Text>
            <Text style={styles.optionText}>Collaborative Post</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <View style={styles.toolbar}>
        <TouchableOpacity style={styles.toolbarButton} onPress={handleImagePick}>
          <Text style={styles.toolbarIcon}>🖼️</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cancelButton: {
    fontSize: 16,
    color: COLORS.textGray,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  postButton: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.primary,
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
    backgroundColor: COLORS.primary,
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
    color: COLORS.text,
  },
  userUsername: {
    fontSize: 14,
    color: COLORS.textGray,
  },
  textInput: {
    fontSize: 16,
    color: COLORS.text,
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
    color: COLORS.text,
  },
  toolbar: {
    flexDirection: 'row',
    padding: 15,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  toolbarButton: {
    marginRight: 15,
  },
  toolbarIcon: {
    fontSize: 24,
  },
});

export default CreatePostScreen;
