import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { API_URL } from '../utils/constants';

// Cookie-based auth (matches web):
// backend sets httpOnly cookie "jwt" on login/signup; we must send cookies on every request.
// Axios in RN supports this via `withCredentials: true` (uses native cookie store).

// Logout callback - will be set by UserContext
let logoutCallback: (() => void) | null = null;

export const setLogoutCallback = (callback: () => void) => {
  logoutCallback = callback;
};

const client = axios.create({
  baseURL: API_URL,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

client.interceptors.request.use((config) => {
  const url = String(config.url || '');
  if (url.includes('/api/user/follow/')) {
    config.headers = config.headers || {};
    (config.headers as Record<string, string>)['X-Client-Type'] = 'mobile';
  }
  return config;
});

client.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<any>) => {
    const status = error.response?.status;
    if (status === 401 && logoutCallback) {
      logoutCallback();
    }
    return Promise.reject(error);
  }
);

const getErrorMessage = (error: any) => {
  if (axios.isAxiosError(error)) {
    return (
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'Request failed'
    );
  }
  return error?.message || 'Request failed';
};

export const apiService = {
  get: async (url: string, config?: AxiosRequestConfig) => {
    const openingVideo = /\/api\/video-message\/[a-f0-9]{24}/i.test(String(url));
    try {
      if (openingVideo) console.log('[video-message] open', `${API_URL}${url}`);
      const res = await client.get(url, config);
      if (openingVideo) console.log('[video-message] open ok', res.status);
      return res.data;
    } catch (e) {
      if (openingVideo) {
        const ax = axios.isAxiosError(e) ? e : null;
        console.log('[video-message] open failed', {
          url: `${API_URL}${url}`,
          message: ax?.message || (e as any)?.message,
          code: ax?.code,
          status: ax?.response?.status,
          data: ax?.response?.data,
        });
      }
      throw new Error(getErrorMessage(e));
    }
  },

  post: async (url: string, data?: any, config?: AxiosRequestConfig) => {
    try {
      const res = await client.post(url, data, config);
      return res.data;
    } catch (e) {
      throw new Error(getErrorMessage(e));
    }
  },

  put: async (url: string, data?: any, config?: AxiosRequestConfig) => {
    try {
      const res = await client.put(url, data, config);
      return res.data;
    } catch (e) {
      throw new Error(getErrorMessage(e));
    }
  },

  delete: async (url: string, config?: AxiosRequestConfig) => {
    try {
      const res = await client.delete(url, config);
      return res.data;
    } catch (e) {
      throw new Error(getErrorMessage(e));
    }
  },
};

export default apiService;
