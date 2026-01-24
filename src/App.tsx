import React, { useEffect } from 'react';
import { StatusBar, I18nManager } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { UserProvider } from './context/UserContext';
import { PostProvider } from './context/PostContext';
import { SocketProvider } from './context/SocketContext';
import { WebRTCProvider } from './context/WebRTCContext';
import { LanguageProvider } from './context/LanguageContext';
import { ThemeProvider } from './context/ThemeContext';
import AppNavigator from './navigation/AppNavigator';
import fcmService from './services/fcmService';
import oneSignalService from './services/onesignal';

const App = () => {
  useEffect(() => {
    // Force LTR (Left-to-Right) layout regardless of phone language
    // This prevents the app from flipping when phone is set to Arabic
    if (I18nManager.isRTL) {
      I18nManager.allowRTL(false);
      I18nManager.forceRTL(false);
      console.log('🔄 [App] Forced LTR layout (disabled RTL)');
    }

    // Initialize Firebase Cloud Messaging for call notifications (WhatsApp-like)
    console.log('🔥 [App] Initializing FCM...');
    fcmService.initialize().catch((err) => {
      console.error('❌ [App] FCM initialization error:', err);
      console.error('❌ [App] Error details:', JSON.stringify(err, null, 2));
      console.error('❌ [App] Error message:', err?.message);
      console.error('❌ [App] Error stack:', err?.stack);
      // Retry after a delay if Firebase isn't ready yet
      setTimeout(() => {
        console.log('🔄 [App] Retrying FCM initialization...');
        fcmService.initialize().catch((retryErr) => {
          console.error('❌ [App] FCM initialization failed after retry:', retryErr);
          console.error('❌ [App] Retry error details:', JSON.stringify(retryErr, null, 2));
        });
      }, 2000);
    });

    // Initialize OneSignal for non-call push notifications (likes, comments, follows, chess, etc.)
    console.log('🔔 [App] Initializing OneSignal...');
    oneSignalService.initialize();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" backgroundColor="#000000" />
        <ThemeProvider>
          <LanguageProvider>
            <UserProvider>
              <PostProvider>
                <SocketProvider>
                  <WebRTCProvider>
                    <AppNavigator />
                  </WebRTCProvider>
                </SocketProvider>
              </PostProvider>
            </UserProvider>
          </LanguageProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

export default App;
