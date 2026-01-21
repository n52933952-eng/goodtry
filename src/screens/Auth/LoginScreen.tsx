import React, { useState, useEffect } from 'react';
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
} from 'react-native';
import { useUser } from '../../context/UserContext';
import { useLanguage } from '../../context/LanguageContext';
import { apiService } from '../../services/api';
import { ENDPOINTS, COLORS } from '../../utils/constants';
import { useShowToast } from '../../hooks/useShowToast';

const LoginScreen = ({ navigation }: any) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  
  const { login } = useUser();
  const { language, setLanguage, t, isRTL } = useLanguage();
  const showToast = useShowToast();

  // Note: I18nManager.forceRTL() requires app restart to take full effect
  // For now, we'll apply RTL styles manually via isRTL flag

  const handleToggleLanguage = () => {
    const newLanguage = language === 'en' ? 'ar' : 'en';
    setLanguage(newLanguage);
  };

  const handleLogin = async () => {
    if (!username || !password) {
      showToast(t('error'), t('pleaseFillAllFields'), 'error');
      return;
    }

    setLoading(true);
    try {
      const response = await apiService.post(ENDPOINTS.LOGIN, {
        username: username.toLowerCase(),
        password,
      });

      if (response.error) {
        showToast('Error', response.error, 'error');
        return;
      }

      // Save user (session is stored as httpOnly cookie, like web)
      await login(response);
      showToast(t('success'), t('loggedInSuccessfully'), 'success');
    } catch (error: any) {
      console.error('Login error:', error);
      showToast(
        t('error'),
        error.message || t('failedToLogin'),
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scrollContainer}>
        <View style={styles.content}>
          {/* Language Toggle Button */}
          <TouchableOpacity 
            style={styles.languageToggle}
            onPress={handleToggleLanguage}
          >
            <Text style={styles.languageToggleText}>
              {language === 'en' ? '🇬🇧 EN' : '🇸🇦 AR'}
            </Text>
          </TouchableOpacity>

          <Text style={[styles.title, isRTL && styles.titleRTL]}>{t('welcomeBack')}</Text>
          <Text style={[styles.subtitle, isRTL && styles.subtitleRTL]}>{t('loginToAccount')}</Text>

          <View style={styles.form}>
            <TextInput
              style={[styles.input, isRTL && styles.inputRTL]}
              placeholder={t('username')}
              placeholderTextColor={COLORS.textGray}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              textAlign={isRTL ? 'right' : 'left'}
            />

            <View style={styles.passwordContainer}>
              <TextInput
                style={[styles.input, styles.passwordInput, isRTL && styles.inputRTL]}
                placeholder={t('password')}
                placeholderTextColor={COLORS.textGray}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                textAlign={isRTL ? 'right' : 'left'}
              />
              <TouchableOpacity
                style={styles.eyeButton}
                onPress={() => setShowPassword((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Text style={styles.eyeText}>{showPassword ? '👁️' : '🔒'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{t('login')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => navigation.navigate('Signup')}
            >
              <Text style={[styles.linkText, isRTL && styles.linkTextRTL]}>
                {t('dontHaveAccount')} <Text style={styles.linkTextBold}>{t('signUp')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
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
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 15,
    marginBottom: 15,
    color: COLORS.text,
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
  button: {
    backgroundColor: COLORS.primary,
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
  languageToggle: {
    position: 'absolute',
    top: 20,
    right: 20,
    padding: 10,
    borderRadius: 8,
    backgroundColor: COLORS.backgroundLight,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  languageToggleText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: COLORS.text,
  },
  titleRTL: {
    textAlign: 'right',
  },
  subtitleRTL: {
    textAlign: 'right',
  },
  inputRTL: {
    textAlign: 'right',
  },
  linkTextRTL: {
    textAlign: 'center',
  },
});

export default LoginScreen;
