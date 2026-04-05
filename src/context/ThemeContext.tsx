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

// Light Theme — slightly muted canvas so white / light surfaces read as cards
const blueTheme: ThemeColors = {
  primary: '#1D9BF0', // Accent buttons (create, highlights)
  background: '#E4E9F0', // App page background (darker than before — cards pop)
  backgroundLight: '#F6F8FB', // Headers, post shells, sections (off-white vs page)
  text: '#0F172A', // Main text on light backgrounds
  textGray: '#64748B', // Secondary text
  border: '#D1D9E4', // Slightly stronger borders for separation
  error: '#E11D48',
  success: '#16A34A',
  warning: '#D97706',
  avatarBg: '#1D9BF0', // Keep avatars vibrant and visible
  buttonText: '#FFFFFF', // White text on primary colored buttons
  cardBg: '#FFFFFF', // Inner cards (weather, etc.) stay crisp on top of backgroundLight
  cardText: '#0F172A', // Dark text on cards
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
