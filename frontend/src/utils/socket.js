// src/utils/socket.js
import { io } from 'socket.io-client';
import api from './api';

let socketInstance = null;
let connectionPromise = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 3;

// Use environment variable or fallback to localhost
const SOCKET_URL = import.meta.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

const createSocketInstance = (token) => {
  return io(SOCKET_URL, {
    auth: { token },
    withCredentials: true,
    autoConnect: false,
    reconnection: false, // We'll handle reconnection manually
    transports: ['websocket', 'polling'], // Fallback to polling if websocket fails
    timeout: 20000, // 20 seconds timeout
    forceNew: true // Always create a new connection
  });
};

export const isSocketConnected = () => {
  return socketInstance?.connected;
};

export const connectSocket = async (token) => {
  if (socketInstance && socketInstance.connected) {
    return socketInstance;
  }

  // Disconnect existing instance if any
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }

  socketInstance = createSocketInstance(token);
  connectionPromise = new Promise((resolve, reject) => {
    const connectTimeout = setTimeout(() => {
      reject(new Error('Socket connection timed out'));
    }, 15000); // 15 seconds timeout

    const cleanup = () => {
      clearTimeout(connectTimeout);
      socketInstance.off('connect', onConnect);
      socketInstance.off('connect_error', onError);
      socketInstance.off('disconnect', onDisconnect);
    };

    const onConnect = () => {
      cleanup();
      reconnectAttempts = 0; // Reset on successful connection
      console.log('Socket connected successfully');
      resolve(socketInstance);
    };

    const onError = async (err) => {
      cleanup();
      console.error('Socket connection error:', err);
      
      try {
        if ((err.message.includes('unauthorized') || err.message.includes('jwt')) && 
            reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          console.log(`Attempting token refresh (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          
          // Attempt token refresh
          const { data } = await api.post('/auth/refresh');
          localStorage.setItem('accessToken', data.token);
          
          // Create new instance with fresh token
          socketInstance = createSocketInstance(data.token);
          socketInstance.connect();
        } else {
          if (err.message.includes('unauthorized')) {
            console.log('Token refresh failed, redirecting to login');
            window.location.href = '/login';
          }
          reject(err);
        }
      } catch (refreshErr) {
        console.error('Token refresh error:', refreshErr);
        if (refreshErr.response?.status === 401) {
          console.log('Token refresh failed with 401, redirecting to login');
          window.location.href = '/login';
        }
        reject(refreshErr);
      }
    };

    const onDisconnect = (reason) => {
      console.log('Socket disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server disconnected us, try to reconnect
        console.log('Server disconnected, attempting to reconnect...');
        socketInstance.connect();
      }
    };

    socketInstance.once('connect', onConnect);
    socketInstance.once('connect_error', onError);
    socketInstance.on('disconnect', onDisconnect);
    socketInstance.connect();
  });

  return connectionPromise;
};

export const getSocket = async () => {
  if (socketInstance?.connected) {
    return socketInstance;
  }

  const token = localStorage.getItem('accessToken');
  if (!token) {
    throw new Error('No access token available');
  }

  if (!socketInstance) {
    return connectSocket(token);
  }

  try {
    return await connectionPromise;
  } catch (err) {
    console.error("Socket connection failed:", err);
    throw err;
  }
};

export const disconnectSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
    connectionPromise = null;
  }
};

// Add a function to check socket health
export const checkSocketHealth = () => {
  if (!socketInstance) {
    return { connected: false, reason: 'No socket instance' };
  }
  
  return {
    connected: socketInstance.connected,
    id: socketInstance.id,
    transport: socketInstance.io.engine.transport.name
  };
};