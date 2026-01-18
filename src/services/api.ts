import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL, STORAGE_KEYS } from '../utils/constants';

// Logout callback - will be set by UserContext
let logoutCallback: (() => void) | null = null;

export const setLogoutCallback = (callback: () => void) => {
  logoutCallback = callback;
};

// Helper function to handle fetch responses
const handleResponse = async (response: Response) => {
  const text = await response.text();
  let data;
  
  try {
    data = text ? JSON.parse(text) : {};
  } catch (error) {
    console.error('Invalid JSON response:', text.substring(0, 200));
    throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
  }

  if (!response.ok) {
    // Handle 401 - Unauthorized (token invalid/expired)
    if (response.status === 401) {
      console.log('🔐 Token invalid/expired - logging out...');
      
      // Clear storage
      await AsyncStorage.multiRemove([STORAGE_KEYS.USER, STORAGE_KEYS.TOKEN]);
      
      // Call logout callback to clear app state
      if (logoutCallback) {
        logoutCallback();
      }
    }
    
    throw new Error(data.error || data.message || `HTTP ${response.status}`);
  }

  return data;
};

// Helper to get headers with auth token
const getHeaders = async (customHeaders: Record<string, string> = {}) => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };

  try {
    const token = await AsyncStorage.getItem(STORAGE_KEYS.TOKEN);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch (error) {
    console.error('Error getting token:', error);
  }

  return headers;
};

// API Methods using fetch
export const apiService = {
  get: async (url: string, config?: RequestInit) => {
    const headers = await getHeaders(config?.headers as Record<string, string>);
    
    const response = await fetch(`${API_URL}${url}`, {
      method: 'GET',
      headers,
      ...config,
    });

    return handleResponse(response);
  },

  post: async (url: string, data?: any, config?: RequestInit) => {
    const headers = await getHeaders(config?.headers as Record<string, string>);
    
    const response = await fetch(`${API_URL}${url}`, {
      method: 'POST',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      ...config,
    });

    return handleResponse(response);
  },

  put: async (url: string, data?: any, config?: RequestInit) => {
    const headers = await getHeaders(config?.headers as Record<string, string>);
    
    const response = await fetch(`${API_URL}${url}`, {
      method: 'PUT',
      headers,
      body: data ? JSON.stringify(data) : undefined,
      ...config,
    });

    return handleResponse(response);
  },

  delete: async (url: string, config?: RequestInit) => {
    const headers = await getHeaders(config?.headers as Record<string, string>);
    
    const response = await fetch(`${API_URL}${url}`, {
      method: 'DELETE',
      headers,
      ...config,
    });

    return handleResponse(response);
  },

  // Upload with multipart/form-data
  upload: async (url: string, formData: FormData) => {
    try {
      // Don't set Content-Type header for FormData, fetch will set it with boundary
      const token = await AsyncStorage.getItem(STORAGE_KEYS.TOKEN);
      const headers: Record<string, string> = {};
      
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }

      console.log('Uploading to:', `${API_URL}${url}`);
      
      const response = await fetch(`${API_URL}${url}`, {
        method: 'POST',
        headers,
        body: formData,
      });

      console.log('Upload response status:', response.status);
      return handleResponse(response);
    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  },
};

export default apiService;
