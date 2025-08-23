// src/utils/socket.js
import { io } from 'socket.io-client';
import api from './api';

let socketInstance = null;
let connectionPromise = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Use environment variable or fallback to localhost
const SOCKET_URL = import.meta.env.REACT_APP_SOCKET_URL || 'http://localhost:5000';

const createSocketInstance = (token) => {
  return io(SOCKET_URL, {
    auth: { token },
    withCredentials: true,
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 30000,
    transports: ['websocket', 'polling'],
    forceNew: false
  });
};

export const isSocketConnected = () => {
  return socketInstance?.connected || false;
};

export const connectSocket = async (token) => {
  try {
    // If we already have a connected socket, return it
    if (socketInstance && socketInstance.connected) {
      console.log('Socket already connected, returning existing instance');
      return socketInstance;
    }

    // If we have a socket but it's not connected, try to connect
    if (socketInstance && !socketInstance.connected) {
      console.log('Socket exists but not connected, attempting to connect...');
      socketInstance.connect();
      
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Socket connection timeout'));
        }, 10000);

        const onConnect = () => {
          clearTimeout(timeout);
          socketInstance.off('connect', onConnect);
          socketInstance.off('connect_error', onError);
          resolve(socketInstance);
        };

        const onError = (error) => {
          clearTimeout(timeout);
          socketInstance.off('connect', onConnect);
          socketInstance.off('connect_error', onError);
          reject(error);
        };

        socketInstance.once('connect', onConnect);
        socketInstance.once('connect_error', onError);
      });
    }

    // Create new socket instance
    console.log('Creating new socket instance...');
    socketInstance = createSocketInstance(token);
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Socket connection timeout'));
      }, 15000);

      const onConnect = () => {
        clearTimeout(timeout);
        reconnectAttempts = 0;
        console.log('Socket connected successfully');
        socketInstance.off('connect', onConnect);
        socketInstance.off('connect_error', onError);
        resolve(socketInstance);
      };

      const onError = async (error) => {
        clearTimeout(timeout);
        console.error('Socket connection error:', error);
        
        // Handle authentication errors
        if (error.message.includes('unauthorized') || error.message.includes('jwt')) {
          try {
            if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts++;
              console.log(`Attempting token refresh (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
              
              const { data } = await api.post('/auth/refresh');
              localStorage.setItem('accessToken', data.token);
              
              // Create new instance with fresh token
              socketInstance = createSocketInstance(data.token);
              socketInstance.connect();
              
              // Wait for connection
              socketInstance.once('connect', () => {
                console.log('Socket connected after token refresh');
                resolve(socketInstance);
              });
              
              socketInstance.once('connect_error', (refreshError) => {
                console.error('Socket connection failed after token refresh:', refreshError);
                reject(refreshError);
              });
              
              return;
            }
          } catch (refreshErr) {
            console.error('Token refresh failed:', refreshErr);
          }
        }
        
        socketInstance.off('connect', onConnect);
        socketInstance.off('connect_error', onError);
        reject(error);
      };

      socketInstance.once('connect', onConnect);
      socketInstance.once('connect_error', onError);
      socketInstance.connect();
    });
  } catch (error) {
    console.error('Socket connection failed:', error);
    throw error;
  }
};

export const getSocket = async () => {
  try {
    const token = localStorage.getItem('accessToken');
    if (!token) {
      throw new Error('No access token available');
    }

    // If we have a connected socket, return it
    if (socketInstance && socketInstance.connected) {
      return socketInstance;
    }

    // If we have a connection promise, wait for it
    if (connectionPromise) {
      return await connectionPromise;
    }

    // Create new connection
    connectionPromise = connectSocket(token);
    const socket = await connectionPromise;
    connectionPromise = null;
    return socket;
  } catch (error) {
    console.error('Failed to get socket:', error);
    connectionPromise = null;
    throw error;
  }
};

export const disconnectSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
  connectionPromise = null;
  reconnectAttempts = 0;
};

export const checkSocketHealth = () => {
  if (!socketInstance) {
    return { connected: false, reason: 'No socket instance' };
  }
  
  return {
    connected: socketInstance.connected,
    id: socketInstance.id,
    transport: socketInstance.io?.engine?.transport?.name || 'unknown'
  };
};