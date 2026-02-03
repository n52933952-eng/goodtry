import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from '../utils/constants';

class SocketService {
  private socket: Socket | null = null;
  private isConnected: boolean = false;
  private pendingListeners: Array<{ event: string; callback: (data: any) => void }> = [];
  private connectListeners: Array<() => void> = [];

  addConnectListener(fn: () => void): () => void {
    this.connectListeners.push(fn);
    return () => {
      this.connectListeners = this.connectListeners.filter((f) => f !== fn);
    };
  }

  connect(userId: string) {
    // If socket already exists and is connected or connecting, don't create a new one
    if (this.socket) {
      if (this.socket.connected) {
        console.log('✅ Socket already connected');
        return;
      }
      // If socket exists but not connected, remove all listeners before reconnecting
      console.log('🔄 Socket exists but not connected - removing old listeners');
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    console.log('🔌 Connecting to socket...', SOCKET_URL);
    
    this.socket = io(SOCKET_URL, {
      transports: ['websocket', 'polling'], // Polling fallback when websocket times out (e.g. slow network / cold start)
      query: { userId },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 15,
      timeout: 15000, // Longer timeout for slow networks / backend cold start (e.g. Render)
      forceNew: true,
    });

    // Apply any pending listeners that were added before connection
    if (this.pendingListeners.length > 0) {
      console.log(`📋 Applying ${this.pendingListeners.length} pending listeners`);
      this.pendingListeners.forEach(({ event, callback }) => {
        this.socket?.on(event, callback);
      });
      this.pendingListeners = [];
    }

    // CRITICAL: Remove any existing listeners first to prevent duplicates
    // Use once() for connect/disconnect events to ensure they only fire once
    this.socket.removeAllListeners('connect');
    this.socket.removeAllListeners('disconnect');
    this.socket.removeAllListeners('connect_error');
    this.socket.removeAllListeners('error');

    this.socket.on('connect', () => {
      console.log('✅ Socket connected:', this.socket?.id);
      this.isConnected = true;
      this.connectListeners.forEach((f) => {
        try {
          f();
        } catch (e) {
          console.warn('[Socket] Connect listener error:', e);
        }
      });
    });

    this.socket.on('disconnect', (reason) => {
      console.log('❌ Socket disconnected:', reason);
      this.isConnected = false;
    });

    this.socket.on('connect_error', (error) => {
      const isTimeout = error?.message?.toLowerCase?.().includes('timeout');
      if (isTimeout) {
        console.warn('⚠️ [Socket] Connection timeout – will retry. If backend is cold-starting, this is normal.');
      } else {
        console.warn('⚠️ [Socket] Connection error:', error?.message || error);
      }
    });

    this.socket.on('error', (error) => {
      console.error('Socket error:', error);
    });
  }

  disconnect() {
    if (this.socket) {
      console.log('Disconnecting socket...');
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
    }
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.socket) {
      console.log(`📋 Socket not initialized yet, queueing listener for: ${event}`);
      this.pendingListeners.push({ event, callback });
      return;
    }
    console.log(`👂 Setting up listener for event: ${event}`);
    this.socket.on(event, callback);
  }

  off(event: string, callback?: (data: any) => void) {
    if (!this.socket) return;
    if (callback) {
      this.socket.off(event, callback);
    } else {
      this.socket.off(event);
    }
  }

  emit(event: string, data?: any) {
    if (!this.socket) {
      console.warn('⚠️ [Socket] Cannot emit - socket not initialized:', event);
      return;
    }
    
    // Check actual socket connection status, not just the flag
    const isActuallyConnected = this.socket.connected === true;
    if (!isActuallyConnected) {
      console.warn('⚠️ [Socket] Cannot emit - socket not connected:', event, '(connected:', this.socket.connected, ', isConnected flag:', this.isConnected, ')');
      return;
    }
    
    console.log('📡 [Socket] Emitting event:', event, data ? '(with data)' : '(no data)');
    this.socket.emit(event, data);
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  isSocketConnected(): boolean {
    return this.isConnected && this.socket?.connected === true;
  }
  
  // Get the raw socket instance (for checking connection status)
  getSocketInstance(): Socket | null {
    return this.socket;
  }
}

export default new SocketService();
