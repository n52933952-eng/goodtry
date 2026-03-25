import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { useShowToast } from '../../hooks/useShowToast';
import { apiService } from '../../services/api';
import { ENDPOINTS } from '../../utils/constants';
import { useLanguage } from '../../context/LanguageContext';

const UpdateProfileScreen = ({ navigation }: any) => {
  const { user, setUser } = useUser();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const { t } = useLanguage();
  const [updating, setUpdating] = useState(false);
  const [imageFile, setImageFile] = useState<any>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const [inputs, setInputs] = useState({
    name: user?.name || '',
    username: user?.username || '',
    email: user?.email || '',
    bio: user?.bio || '',
    country: user?.country || '',
    password: '',
  });

  const handleImageChange = async () => {
    try {
      const res = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        quality: 0.8,
        includeBase64: false,
      });
      
      if (res.didCancel) return;
      const asset = res.assets?.[0];
      if (asset?.uri) {
        setImageFile(asset);
        setImagePreview(asset.uri);
      }
    } catch (e) {
      console.error('❌ [UpdateProfile] handleImageChange error:', e);
      showToast(t('error'), t('failedToSelectImage'), 'error');
    }
  };

  const handleSubmit = async () => {
    if (!user?._id) {
      showToast(t('error'), t('userNotFound'), 'error');
      return;
    }

    setUpdating(true);
    try {
      let response: any = null;
      const url = `${ENDPOINTS.UPDATE_USER_PROFILE}/${user._id}`;
      console.log('🧑‍💼 [UpdateProfile] Updating profile via:', url);

      // If image selected, upload via FormData
      if (imageFile) {
        const formData = new FormData();
        formData.append('name', inputs.name);
        formData.append('username', inputs.username);
        formData.append('email', inputs.email);
        formData.append('bio', inputs.bio || '');
        formData.append('country', inputs.country || '');
        if (inputs.password.trim()) {
          formData.append('password', inputs.password);
        }

        const uri = imageFile.uri;
        const name = imageFile.fileName || `profile_${Date.now()}.jpg`;
        const type = imageFile.type || 'image/jpeg';

        // @ts-ignore - RN FormData file shape
        formData.append('file', { uri, name, type });

        // Backend expects PUT method for /api/user/update/:id (same as web)
        response = await apiService.upload(url, formData, 'PUT');
      } else {
        // No image - just send JSON
        const payload: any = {
          name: inputs.name,
          username: inputs.username,
          email: inputs.email,
          bio: inputs.bio || '',
          country: inputs.country || '',
          profilePic: user.profilePic, // Keep existing profile pic
        };
        if (inputs.password.trim()) {
          payload.password = inputs.password;
        }

        response = await apiService.put(`${ENDPOINTS.UPDATE_USER_PROFILE}/${user._id}`, payload);
      }

      if (response) {
        // Update user context
        setUser(response);
        showToast(t('success'), t('profileUpdatedSuccessfully'), 'success');
        navigation.goBack();
      }
    } catch (error: any) {
      console.error('❌ [UpdateProfile] handleSubmit error:', error);
      showToast(t('error'), error?.message || t('failedToUpdateProfile'), 'error');
    } finally {
      setUpdating(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: colors.backgroundLight,
      color: colors.text,
      borderColor: colors.border,
    },
  ];

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: colors.background }]}
      contentContainerStyle={[styles.content, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={[styles.backButton, { color: colors.text }]}>←</Text>
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>{t('updateProfile')}</Text>
        <View style={{ width: 30 }} />
      </View>

      <View style={styles.form}>
        {/* Profile Picture */}
        <View style={styles.avatarSection}>
          {imagePreview || user?.profilePic ? (
            <Image
              source={{ uri: imagePreview || user?.profilePic }}
              style={styles.avatar}
            />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
              <Text style={styles.avatarText}>
                {inputs.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <TouchableOpacity
            style={[styles.changeAvatarBtn, { backgroundColor: colors.primary }]}
            onPress={handleImageChange}
          >
            <Text style={styles.changeAvatarText}>{t('changeAvatar')}</Text>
          </TouchableOpacity>
        </View>

        {/* Full Name */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>{t('fullName')}</Text>
          <TextInput
            style={inputStyle}
            value={inputs.name}
            onChangeText={(text) => setInputs({ ...inputs, name: text })}
            placeholder="John Doe"
            placeholderTextColor={colors.textGray}
          />
        </View>

        {/* Username */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>{t('username')}</Text>
          <TextInput
            style={inputStyle}
            value={inputs.username}
            onChangeText={(text) => setInputs({ ...inputs, username: text })}
            placeholder="johndoe"
            placeholderTextColor={colors.textGray}
            autoCapitalize="none"
          />
        </View>

        {/* Email */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>{t('email')}</Text>
          <TextInput
            style={inputStyle}
            value={inputs.email}
            onChangeText={(text) => setInputs({ ...inputs, email: text })}
            placeholder="your-email@example.com"
            placeholderTextColor={colors.textGray}
            keyboardType="email-address"
            autoCapitalize="none"
          />
        </View>

        {/* Bio */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>{t('bio')}</Text>
          <TextInput
            style={[...inputStyle, styles.textArea]}
            value={inputs.bio}
            onChangeText={(text) => setInputs({ ...inputs, bio: text })}
            placeholder={t('yourBio')}
            placeholderTextColor={colors.textGray}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Country */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>{t('country')}</Text>
          <TextInput
            style={inputStyle}
            value={inputs.country}
            onChangeText={(text) => setInputs({ ...inputs, country: text })}
            placeholder={t('selectCountryPlaceholder')}
            placeholderTextColor={colors.textGray}
          />
        </View>

        {/* Password (optional) */}
        <View style={styles.inputGroup}>
          <Text style={[styles.label, { color: colors.text }]}>{t('passwordLeaveEmpty')}</Text>
          <TextInput
            style={inputStyle}
            value={inputs.password}
            onChangeText={(text) => setInputs({ ...inputs, password: text })}
            placeholder={t('newPasswordPlaceholder')}
            placeholderTextColor={colors.textGray}
            secureTextEntry
          />
        </View>

        {/* Submit Button */}
        <TouchableOpacity
          style={[
            styles.submitButton,
            { backgroundColor: colors.primary },
            updating && styles.submitButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={updating}
        >
          {updating ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.submitButtonText}>{t('updateProfile')}</Text>
          )}
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingTop: 10,
  },
  backButton: {
    fontSize: 24,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  form: {
    gap: 20,
  },
  avatarSection: {
    alignItems: 'center',
    marginBottom: 10,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 15,
  },
  avatarPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 40,
    fontWeight: 'bold',
  },
  changeAvatarBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  changeAvatarText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  inputGroup: {
    marginBottom: 15,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 8,
  },
  input: {
    borderRadius: 10,
    padding: 15,
    fontSize: 16,
    borderWidth: 1,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  submitButton: {
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default UpdateProfileScreen;
