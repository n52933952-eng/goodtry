import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { STORAGE_KEYS } from '../utils/constants';

type Theme = 'dark' | 'blue';

interface ThemeColors {
  primary: string;
  background: string;
  backgroundLight: string;
  text: string;
  textGray: string;
  border: string;
  error: string;
  success: string;
  warning: string;
  avatarBg: string; // Special color for avatar placeholders
  buttonText: string; // Text color for buttons
  cardBg: string; // Background for cards/posts
  cardText: string; // Text color for cards/posts
}

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// Dark Theme (Original - Black)
const darkTheme: ThemeColors = {
  primary: '#1DA1F2',
  background: '#000000',
  backgroundLight: '#16181C',
  text: '#FFFFFF',
  textGray: '#8B98A5',
  border: '#2F3336',
  error: '#F4212E',
  success: '#00BA7C',
  warning: '#FFD400',
  avatarBg: '#1DA1F2', // Blue for avatars
  buttonText: '#FFFFFF', // White text on buttons
  cardBg: '#16181C', // Dark gray for cards
  cardText: '#FFFFFF', // White text on cards
};

// Blue Theme (Darker)
const blueTheme: ThemeColors = {
  primary: '#FFFFFF', // White as primary on blue background
  background: '#0D47A1', // Dark blue background (much darker)
  backgroundLight: '#1565C0', // Medium dark blue
  text: '#FFFFFF', // White text
  textGray: '#90CAF9', // Lighter blue for secondary text
  border: '#1976D2', // Medium blue border
  error: '#FF5252',
  success: '#69F0AE',
  warning: '#FFD740',
  avatarBg: '#1976D2', // Medium blue for avatars (visible on blue backgrounds)
  buttonText: '#000000', // Black text on white buttons
  cardBg: '#FFFFFF', // White cards
  cardText: '#000000', // Black text on cards
};

export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  const [theme, setTheme] = useState<Theme>('dark');
  const [colors, setColors] = useState<ThemeColors>(darkTheme);

  // Load saved theme on mount
  useEffect(() => {
    loadTheme();
  }, []);

  const loadTheme = async () => {
    try {
      const savedTheme = await AsyncStorage.getItem(STORAGE_KEYS.THEME);
      if (savedTheme === 'blue' || savedTheme === 'dark') {
        setTheme(savedTheme);
        setColors(savedTheme === 'blue' ? blueTheme : darkTheme);
        console.log('🎨 [Theme] Loaded theme:', savedTheme);
      }
    } catch (error) {
      console.error('❌ [Theme] Error loading theme:', error);
    }
  };

  const toggleTheme = async () => {
    try {
      const newTheme: Theme = theme === 'dark' ? 'blue' : 'dark';
      const newColors = newTheme === 'blue' ? blueTheme : darkTheme;
      
      setTheme(newTheme);
      setColors(newColors);
      
      await AsyncStorage.setItem(STORAGE_KEYS.THEME, newTheme);
      console.log('🎨 [Theme] Theme changed to:', newTheme);
    } catch (error) {
      console.error('❌ [Theme] Error saving theme:', error);
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, colors }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};
