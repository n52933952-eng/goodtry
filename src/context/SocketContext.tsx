import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import socketService from '../services/socket';
import { useUser } from './UserContext';
import { usePost } from './PostContext';
import { SOCKET_EVENTS } from '../utils/constants';

interface SocketContextType {
  socket: typeof socketService;
  onlineUsers: any[];
  chessChallenge: any | null;
  clearChessChallenge: () => void;
  notificationCount: number;
  setNotificationCount: (count: number | ((prev: number) => number)) => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useUser();
  const { addPost, updatePost, deletePost } = usePost();
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [chessChallenge, setChessChallenge] = useState<any | null>(null);
  const [notificationCount, setNotificationCount] = useState<number>(0);

  useEffect(() => {
    if (!user) return;

    // CRITICAL: Remove all existing listeners first to prevent duplicates
    // This ensures we don't accumulate listeners if useEffect runs multiple times
    socketService.off('getOnlineUser');
    socketService.off(SOCKET_EVENTS.NEW_POST);
    socketService.off(SOCKET_EVENTS.POST_UPDATED);
    socketService.off(SOCKET_EVENTS.POST_DELETED);
    socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
    socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
    socketService.off(SOCKET_EVENTS.CHESS_MOVE);
    socketService.off('newNotification');

    // Set up listeners - will be queued if socket not ready yet
    console.log('🔧 Setting up socket listeners in SocketContext');

    // Listen for online users updates
    socketService.on('getOnlineUser', (users) => {
      console.log('👥 Online users event received!', users?.length || 0, 'users');
      setOnlineUsers(users || []);
    });

    // Listen for new posts
    socketService.on(SOCKET_EVENTS.NEW_POST, (post) => {
      console.log('📩 New post received:', post);
      addPost(post);
    });

    // Listen for post updates
    socketService.on(SOCKET_EVENTS.POST_UPDATED, (updatedPost) => {
      console.log('✏️ Post updated:', updatedPost);
      updatePost(updatedPost._id, updatedPost);
    });

    // Listen for post deletions
    socketService.on(SOCKET_EVENTS.POST_DELETED, (postId) => {
      console.log('🗑️ Post deleted:', postId);
      deletePost(postId);
    });

    // Listen for football updates
    socketService.on(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE, (data) => {
      console.log('⚽ Football match update:', data);
      // Handle football match updates
    });

    // Listen for chess challenges
    socketService.on(SOCKET_EVENTS.CHESS_CHALLENGE, (data) => {
      console.log('♟️ Chess challenge received:', data);
      // Store for global in-app notification UI (like web)
      setChessChallenge({
        ...data,
        isReceivingChallenge: true,
      });
    });

    // Listen for chess moves
    socketService.on(SOCKET_EVENTS.CHESS_MOVE, (data) => {
      console.log('♟️ Chess move received:', data);
      // Handle chess moves
    });

    // Listen for new notifications
    socketService.on('newNotification', (notification) => {
      console.log('🔔 New notification received:', notification);
      setNotificationCount(prev => prev + 1);
    });

    // Cleanup listeners on unmount
    return () => {
      socketService.off('getOnlineUser');
      socketService.off(SOCKET_EVENTS.NEW_POST);
      socketService.off(SOCKET_EVENTS.POST_UPDATED);
      socketService.off(SOCKET_EVENTS.POST_DELETED);
      socketService.off(SOCKET_EVENTS.FOOTBALL_MATCH_UPDATE);
      socketService.off(SOCKET_EVENTS.CHESS_CHALLENGE);
      socketService.off(SOCKET_EVENTS.CHESS_MOVE);
      socketService.off('newNotification');
    };
  }, [user, addPost, updatePost, deletePost]);

  const clearChessChallenge = () => setChessChallenge(null);

  return (
    <SocketContext.Provider value={{ 
      socket: socketService, 
      onlineUsers, 
      chessChallenge, 
      clearChessChallenge,
      notificationCount,
      setNotificationCount,
    }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within SocketProvider');
  }
  return context;
};
