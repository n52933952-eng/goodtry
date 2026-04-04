import React, { createContext, useState, useContext, useEffect, ReactNode, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';
import socketService from '../services/socket';
import fcmService from '../services/fcmService';
import { setLogoutCallback } from '../services/api';
import { apiService } from '../services/api';
import { ENDPOINTS } from '../utils/constants';

interface User {
  _id: string;
  name: string;
  username: string;
  email: string;
  profilePic?: string;
  followers: string[];
  following: string[];
  weatherCities: string[];
}

interface UserContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  login: (userData: User) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => void;
  isLoading: boolean;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Avoid marking "online" on brief active↔inactive flaps (volume HUD, permission sheets, task-switch animation). */
  const onlinePresenceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persisted setter: keeps AsyncStorage in sync whenever someone calls setUser from context.
  // This prevents "must logout/login to see changes" after profile updates.
  const setUser = (nextUser: User | null) => {
    setUserState(nextUser);
    if (nextUser) {
      AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(nextUser)).catch(() => {});
    } else {
      AsyncStorage.removeItem(STORAGE_KEYS.USER).catch(() => {});
    }
  };

  // Register automatic logout callback for API 401 errors
  useEffect(() => {
    setLogoutCallback(() => {
      console.log('🔐 Auto-logout triggered by API');
      // Ensure we also clear persisted user so app doesn't boot back into MainTabs
      // after restart due to stale AsyncStorage.
      AsyncStorage.removeItem(STORAGE_KEYS.USER).catch(() => {});
      setUserState(null);
    });
  }, []);

  // Load user from storage on app start
  useEffect(() => {
    loadUserFromStorage();
  }, []);

  // FCM token API requires jwt cookie — sync only when logged in (avoids 401 → auto-logout on cold start).
  useEffect(() => {
    if (user?._id) {
      fcmService.setAllowBackendSync(true);
      fcmService.syncTokenWithBackend().catch(() => {});
    } else {
      fcmService.setAllowBackendSync(false);
    }
  }, [user?._id]);

  // Also store user ID in SharedPreferences when user is loaded (in case login happened before this code was added)
  useEffect(() => {
    if (user?._id) {
      const storeUserId = async () => {
        try {
          const { NativeModules } = require('react-native');
          const { CallDataModule } = NativeModules;
          if (CallDataModule && CallDataModule.setCurrentUserId) {
            await CallDataModule.setCurrentUserId(user._id);
            console.log('✅ [UserContext] User ID stored in SharedPreferences (from useEffect):', user._id);
          }
        } catch (e) {
          console.warn('⚠️ [UserContext] Could not store user ID in SharedPreferences:', e);
        }
      };
      storeUserId();
    }
  }, [user?._id]);

  // Connect socket when we have a user id. Use `user?._id` only — not `[user]`.
  // `updateUser` / `setUser` replace the user object often (following, profile); re-running
  // connect on every new reference aborts a socket that is still handshaking (`connected === false`
  // but manager still active), which shows as "online then offline" on the server.
  // Only connect when app is active (foreground). When backgrounded we disconnect so user is
  // offline and backend uses FCM for call notifications.
  useEffect(() => {
    const uid = user?._id;
    if (uid) {
      if (AppState.currentState === 'active') {
        socketService.connect(uid);
      }
    } else {
      socketService.disconnect();
    }
  }, [user?._id]);

  // Presence: only treat true background as "left the app". `inactive` fires for volume UI, overlays, and
  // task-switcher transitions — emitting offline there makes friends see you flip offline/online (green dot flashing).
  useEffect(() => {
    if (!user?._id) return;

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === 'background') {
        if (onlinePresenceDebounceRef.current) {
          clearTimeout(onlinePresenceDebounceRef.current);
          onlinePresenceDebounceRef.current = null;
        }
        socketService.emit('clientPresence', { status: 'offline' });

        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        disconnectTimerRef.current = setTimeout(() => {
          socketService.disconnect();
          console.log('📴 [UserContext] App background – socket disconnected (FCM for calls)');
          disconnectTimerRef.current = null;
        }, 1500);
      } else if (nextState === 'active') {
        if (disconnectTimerRef.current) {
          clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        if (onlinePresenceDebounceRef.current) {
          clearTimeout(onlinePresenceDebounceRef.current);
        }
        const uid = user._id;
        onlinePresenceDebounceRef.current = setTimeout(() => {
          onlinePresenceDebounceRef.current = null;
          if (AppState.currentState !== 'active') return;
          socketService.connect(uid);
          socketService.emit('clientPresence', { status: 'online' });
          console.log('📱 [UserContext] App active – online presence (debounced)');
        }, 450);
      }
      // `inactive`: intentionally no presence/socket change (see comment above).
    };

    const sub = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      sub.remove();
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      if (onlinePresenceDebounceRef.current) {
        clearTimeout(onlinePresenceDebounceRef.current);
        onlinePresenceDebounceRef.current = null;
      }
    };
  }, [user?._id]);

  const loadUserFromStorage = async () => {
    try {
      const [userData] = await AsyncStorage.multiGet([
        STORAGE_KEYS.USER,
      ]);

      if (userData[1]) {
        setUserState(JSON.parse(userData[1]));
      }
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (userData: User) => {
    try {
      // Clear any previous user data first to prevent showing stale data
      // This ensures clean state when switching between users
      setUserState(null);
      await AsyncStorage.removeItem(STORAGE_KEYS.USER).catch(() => {});
      
      // Set new user data
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
      setUserState(userData);
      
      // Store user ID in SharedPreferences for native code (IncomingCallActivity)
      if (userData._id) {
        try {
          const { NativeModules } = require('react-native');
          const { CallDataModule } = NativeModules;
          if (CallDataModule && CallDataModule.setCurrentUserId) {
            await CallDataModule.setCurrentUserId(userData._id);
            console.log('✅ [UserContext] User ID stored in SharedPreferences for native code');
          }
        } catch (e) {
          console.warn('⚠️ [UserContext] Could not store user ID in SharedPreferences:', e);
        }
      }
    } catch (error) {
      console.error('Error saving user:', error);
      throw error;
    }
  };

  const logout = async () => {
    try {
      // Tell backend to clear the httpOnly cookie session
      try {
        await apiService.post(ENDPOINTS.LOGOUT);
      } catch (e) {
        // Best-effort; still clear local state.
        console.warn('⚠️ Logout API failed (continuing local logout):', e);
      }
      await AsyncStorage.removeItem(STORAGE_KEYS.USER);
      socketService.disconnect();
      setUserState(null);
    } catch (error) {
      console.error('Error logging out:', error);
      throw error;
    }
  };

  const updateUser = (updates: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
    }
  };

  return (
    <UserContext.Provider
      value={{ user, setUser, login, logout, updateUser, isLoading }}
    >
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within UserProvider');
  }
  return context;
};
