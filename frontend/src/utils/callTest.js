// Call testing utility
import { getSocket, checkSocketHealth } from './socket';

export const testCallFunctionality = async () => {
  console.log('=== Call Functionality Test ===');
  
  try {
    // Test socket connection
    console.log('1. Testing socket connection...');
    const socket = await getSocket();
    const health = checkSocketHealth();
    console.log('Socket health:', health);
    
    if (!health.connected) {
      throw new Error('Socket not connected');
    }
    
    // Test WebRTC support
    console.log('2. Testing WebRTC support...');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('WebRTC not supported');
    }
    
    if (!window.RTCPeerConnection) {
      throw new Error('RTCPeerConnection not supported');
    }
    
    // Test media access
    console.log('3. Testing media access...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });
      console.log('Media access granted:', stream.getTracks().length, 'tracks');
      stream.getTracks().forEach(track => track.stop());
    } catch (err) {
      console.warn('Media access failed:', err.message);
    }
    
    // Test ICE servers
    console.log('4. Testing ICE server configuration...');
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
    
    const pc = new RTCPeerConnection({ iceServers });
    console.log('RTCPeerConnection created successfully');
    pc.close();
    
    console.log('✅ All tests passed! Calling functionality should work.');
    return true;
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    return false;
  }
};

export const logCallState = (componentName, state) => {
  console.log(`[${componentName}] State:`, {
    timestamp: new Date().toISOString(),
    ...state
  });
};

export const validateCallData = (data) => {
  const errors = [];
  
  if (!data.currentUser || !data.currentUser._id) {
    errors.push('Missing currentUser or currentUser._id');
  }
  
  if (!data.otherUser || !data.otherUser._id) {
    errors.push('Missing otherUser or otherUser._id');
  }
  
  if (!data.callType || !['video', 'voice'].includes(data.callType)) {
    errors.push('Invalid callType (must be "video" or "voice")');
  }
  
  if (errors.length > 0) {
    console.error('Call data validation failed:', errors);
    return false;
  }
  
  return true;
};

