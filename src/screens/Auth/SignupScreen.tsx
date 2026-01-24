import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useTheme } from '../../context/ThemeContext';
import { apiService } from '../../services/api';
import { ENDPOINTS, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';
import { useLanguage } from '../../context/LanguageContext';

const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Australia',
  'Germany',
  'France',
  'Italy',
  'Spain',
  'Netherlands',
  'Belgium',
  'Switzerland',
  'Austria',
  'Sweden',
  'Norway',
  'Denmark',
  'Finland',
  'Poland',
  'Portugal',
  'Greece',
  'Turkey',
  'Russia',
  'Japan',
  'China',
  'India',
  'South Korea',
  'Singapore',
  'Malaysia',
  'Thailand',
  'Indonesia',
  'Philippines',
  'Vietnam',
  'Saudi Arabia',
  'United Arab Emirates',
  'Egypt',
  'Morocco',
  'Tunisia',
  'Algeria',
  'Lebanon',
  'Jordan',
  'Iraq',
  'Kuwait',
  'Qatar',
  'Bahrain',
  'Oman',
  'Yemen',
  'Syria',
  'Palestine',
  'Brazil',
  'Argentina',
  'Mexico',
  'Chile',
  'Colombia',
  'Peru',
  'Venezuela',
  'South Africa',
  'Nigeria',
  'Kenya',
  'Ghana',
  'Ethiopia',
  'Other',
];

const SignupScreen = ({ navigation }: any) => {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [country, setCountry] = useState('');
  const [loading, setLoading] = useState(false);
  const [countryModalVisible, setCountryModalVisible] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const { login } = useUser();
  const { colors } = useTheme();
  const showToast = useShowToast();
  const { t, isRTL } = useLanguage();

  const handleSignup = async () => {
    if (!name || !username || !email || !country || !password) {
      showToast(t('error'), t('pleaseFillAllFields'), 'error');
      return;
    }

    if (password.length < 6) {
      showToast(t('error'), t('passwordMustBe6Chars'), 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.post(ENDPOINTS.SIGNUP, {
        name,
        username: username.toLowerCase(),
        email: email.toLowerCase(),
        country,
        password,
      });

      if (response.error) {
        showToast(t('error'), response.error, 'error');
        return;
      }

      // Backend signup returns { id: "..."} (web), but mobile expects {_id:"..."}
      const normalizedUser =
        response && response._id ? response : { ...response, _id: response?.id };

      // Save user (session is stored as httpOnly cookie, like web)
      await login(normalizedUser);
      showToast(t('success'), t('accountCreatedSuccessfully'), 'success');
    } catch (error: any) {
      console.error('Signup error:', error);
      showToast(
        t('error'),
        error.message || t('failedToCreateAccount'),
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={[styles.content, isRTL && styles.contentRTL]}>
          <Text style={[styles.title, { color: colors.text }]}>{t('createAccount')}</Text>
          <Text style={[styles.subtitle, { color: colors.textGray }]}>{t('signUpToGetStarted')}</Text>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundLight, borderColor: colors.border, color: colors.text }]}
              placeholder={t('fullName')}
              placeholderTextColor={colors.textGray}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundLight, borderColor: colors.border, color: colors.text }]}
              placeholder={t('username')}
              placeholderTextColor={colors.textGray}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextInput
              style={[styles.input, { backgroundColor: colors.backgroundLight, borderColor: colors.border, color: colors.text }]}
              placeholder={t('email')}
              placeholderTextColor={colors.textGray}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoCorrect={false}
            />

            <TouchableOpacity
              style={[styles.select, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}
              onPress={() => setCountryModalVisible(true)}
              activeOpacity={0.85}
            >
              <Text style={[styles.selectText, !country && styles.selectPlaceholder, { color: country ? colors.text : colors.textGray }]}>
                {country || t('selectCountry')}
              </Text>
            </TouchableOpacity>

            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, { backgroundColor: colors.backgroundLight, borderColor: colors.border, color: colors.text }]}
                placeholder={t('passwordMin6')}
                placeholderTextColor={colors.textGray}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? t('hidePassword') : t('showPassword')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={[styles.eyeText, { color: colors.textGray }]}>{showPassword ? '👁️' : '🔒'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled, { backgroundColor: colors.primary }]}
              onPress={handleSignup}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.buttonText || '#FFFFFF'} />
              ) : (
                <Text style={[styles.buttonText, { color: colors.buttonText || '#FFFFFF' }]}>{t('signUp')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => navigation.navigate('Login')}
            >
              <Text style={[styles.linkText, { color: colors.textGray }]}>
                {t('alreadyHaveAccount')} <Text style={[styles.linkTextBold, { color: colors.primary }]}>{t('login')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={countryModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCountryModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor: colors.backgroundLight, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text, borderBottomColor: colors.border }]}>{t('selectCountry')}</Text>
            <FlatList
              data={COUNTRIES}
              keyExtractor={(item) => item}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.modalItem, { borderBottomColor: colors.border }]}
                  onPress={() => {
                    setCountry(item);
                    setCountryModalVisible(false);
                  }}
                >
                  <Text style={[styles.modalItemText, { color: colors.text }]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.modalClose, { borderTopColor: colors.border }]}
              onPress={() => setCountryModalVisible(false)}
            >
              <Text style={[styles.modalCloseText, { color: colors.primary }]}>{t('close')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  contentRTL: {
    // RTL-specific styles if needed
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: COLORS.text,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: COLORS.textGray,
    marginBottom: 40,
  },
  form: {
    width: '100%',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    fontSize: 16,
  },
  passwordContainer: {
    position: 'relative',
    width: '100%',
  },
  passwordInput: {
    paddingRight: 50,
  },
  eyeButton: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  eyeText: {
    fontSize: 18,
    color: COLORS.textGray,
  },
  select: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    justifyContent: 'center',
  },
  selectText: {
    fontSize: 16,
  },
  selectPlaceholder: {
  },
  button: {
    borderRadius: 8,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  linkButton: {
    marginTop: 20,
    alignItems: 'center',
  },
  linkText: {
    color: COLORS.textGray,
    fontSize: 14,
  },
  linkTextBold: {
    color: COLORS.primary,
    fontWeight: 'bold',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    borderRadius: 12,
    borderWidth: 1,
    maxHeight: '80%',
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  modalItemText: {
    fontSize: 16,
  },
  modalClose: {
    padding: 16,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  modalCloseText: {
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default SignupScreen;
