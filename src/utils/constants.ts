// API Configuration
export const API_URL = __DEV__ 
  ? 'https://media-1-aue5.onrender.com' // Production backend (same as web uses in production)
  : 'https://media-1-aue5.onrender.com'; // Production URL

export const SOCKET_URL = API_URL;

// API Endpoints
export const ENDPOINTS = {
  // Auth
  LOGIN: '/api/user/login',
  SIGNUP: '/api/user/signup',
  LOGOUT: '/api/user/logout',
  
  // User
  GET_USER: '/api/user/profile',
  // Web-compatible profile endpoint (accepts username OR userId): /api/user/getUserPro/:query
  GET_USER_PROFILE: '/api/user/getUserPro',
  UPDATE_USER: '/api/user/update',
  FOLLOW_USER: '/api/user/follow',
  UNFOLLOW_USER: '/api/user/unfollow',
  // NOTE: keep both names to avoid breaking older screens
  SEARCH_USER: '/api/user/search',
  SEARCH_USERS: '/api/user/search',
  GET_SUGGESTED_USERS: '/api/user/suggested',
  // Returns list of user objects (server-side limited), used by Messages search
  GET_FOLLOWING_USERS: '/api/user/following',
  // Backward compat name (some older screens may reference this)
  GET_FOLLOWING: '/api/user/following',
  
  // Posts
  GET_FEED: '/api/post/feed/feedpost',
  CREATE_POST: '/api/post/create',
  DELETE_POST: '/api/post',
  // Backend route is /api/post/likes/:id
  LIKE_POST: '/api/post/likes',
  GET_POST: '/api/post',
  GET_USER_POSTS: '/api/post/user',
  
  // Collaborative Posts
  ADD_CONTRIBUTOR: '/api/post/collaborative',
  REMOVE_CONTRIBUTOR: '/api/post/collaborative',
  
  // Comments
  ADD_COMMENT: '/api/post/reply',
  // Keep explicit names (web uses these routes)
  REPLY_POST: '/api/post/reply',
  REPLY_TO_COMMENT: '/api/post/reply-comment',
  LIKE_COMMENT: '/api/post/likecoment',
  DELETE_COMMENT: '/api/post/comment',
  
  // Weather
  GET_WEATHER_CITIES: '/api/weather/cities',
  SAVE_WEATHER_PREFERENCES: '/api/weather/preferences',
  GET_WEATHER_PREFERENCES: '/api/weather/preferences',
  GET_USER_WEATHER: '/api/user/getUserPro/Weather',
  
  // Football
  GET_MATCHES: '/api/football/matches',
  
  // Chess
  CREATE_CHESS_CHALLENGE: '/api/chess/challenge',
  ACCEPT_CHESS_CHALLENGE: '/api/chess/accept',
  MAKE_CHESS_MOVE: '/api/chess/move',
  GET_CHESS_GAME: '/api/chess/game',
  
  // Notifications
  GET_NOTIFICATIONS: '/api/notification',
  MARK_READ: '/api/notification/read',
  
  // Activity
  GET_ACTIVITY: '/api/activity',
  DELETE_ACTIVITY: '/api/activity',
  
  // Messages
  GET_CONVERSATIONS: '/api/message/conversations',
  GET_MESSAGES: '/api/message',
  SEND_MESSAGE: '/api/message',
  MARK_MESSAGES_SEEN: '/api/message/seen',
  DELETE_CONVERSATION: '/api/message/conversation',
  
  // User Profile
  UPDATE_USER_PROFILE: '/api/user/update',
};

// Socket Events
export const SOCKET_EVENTS = {
  NEW_POST: 'newPost',
  POST_UPDATED: 'postUpdated',
  POST_DELETED: 'postDeleted',
  NEW_COMMENT: 'newComment',
  FOOTBALL_MATCH_UPDATE: 'footballMatchUpdate',
  CHESS_CHALLENGE: 'chessChallenge',
  CHESS_MOVE: 'chessMove',
  NOTIFICATION: 'notification',
};

// Storage Keys
export const STORAGE_KEYS = {
  USER: '@user',
  // Token is NOT stored on mobile because backend uses httpOnly cookie session (jwt cookie)
  // Keep the key reserved to avoid breaking older installs, but we no longer use it.
  TOKEN: '@token',
  THEME: '@theme',
};

// Colors
export const COLORS = {
  primary: '#1DA1F2',
  background: '#000000',
  backgroundLight: '#16181C',
  text: '#FFFFFF',
  textGray: '#8B98A5',
  border: '#2F3336',
  error: '#F4212E',
  success: '#00BA7C',
  warning: '#FFD400',
};

// WebRTC Configuration
// Using STUN servers only (works for most cases)
// TURN servers are optional - only needed if users are behind restrictive firewalls/NATs
export const WEBRTC_CONFIG = {
  // STUN servers (free, for NAT discovery - sufficient for most use cases)
  STUN_SERVERS: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
  // TURN servers (optional - add only if needed for restrictive networks)
  // Most calls will work fine with STUN only
  // Uncomment and configure if you encounter connection issues:
  TURN_SERVERS: [
    // {
    //   urls: 'turn:your-turn-server.com:3478',
    //   username: 'your-username',
    //   credential: 'your-password',
    // },
  ],
  // ICE candidate gathering timeout (ms)
  ICE_GATHERING_TIMEOUT: 10000,
  // Connection timeout (ms)
  CONNECTION_TIMEOUT: 30000,
  // Max reconnection attempts
  MAX_RECONNECTION_ATTEMPTS: 3,
};
