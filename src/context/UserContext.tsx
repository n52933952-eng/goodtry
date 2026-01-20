import React, { createContext, useState, useContext, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';
import socketService from '../services/socket';
import fcmService from '../services/fcmService';
import oneSignalService from '../services/onesignal';
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
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Register automatic logout callback for API 401 errors
  useEffect(() => {
    setLogoutCallback(() => {
      console.log('🔐 Auto-logout triggered by API');
      // Ensure we also clear persisted user so app doesn't boot back into MainTabs
      // after restart due to stale AsyncStorage.
      AsyncStorage.removeItem(STORAGE_KEYS.USER).catch(() => {});
      setUser(null);
    });
  }, []);

  // Load user from storage on app start
  useEffect(() => {
    loadUserFromStorage();
  }, []);

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

  // Connect socket and link push notification services when user is available
  useEffect(() => {
    if (user?._id) {
      socketService.connect(user._id);
      // Link user to OneSignal for targeted notifications
      oneSignalService.setUserId(user._id);
      // FCM is initialized in App.tsx, token is automatically sent
    } else {
      socketService.disconnect();
      // Unlink user from OneSignal on logout
      oneSignalService.removeUserId();
    }
  }, [user]);

  const loadUserFromStorage = async () => {
    try {
      const [userData] = await AsyncStorage.multiGet([
        STORAGE_KEYS.USER,
      ]);

      if (userData[1]) {
        setUser(JSON.parse(userData[1]));
      }
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const login = async (userData: User) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(userData));
      setUser(userData);
      
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
      // Unlink user from OneSignal
      oneSignalService.removeUserId();
      setUser(null);
    } catch (error) {
      console.error('Error logging out:', error);
      throw error;
    }
  };

  const updateUser = (updates: Partial<User>) => {
    if (user) {
      const updatedUser = { ...user, ...updates };
      setUser(updatedUser);
      AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(updatedUser));
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
