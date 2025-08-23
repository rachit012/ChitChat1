import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../utils/socket';
import { useCallContext } from '../contexts/CallContext';

const VideoCall = ({ currentUser, otherUser, onClose, callType = 'video', isIncomingCallProp = false }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncomingCallState, setIsIncomingCallState] = useState(isIncomingCallProp);
  const [caller, setCaller] = useState(isIncomingCallProp ? otherUser : null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [isInitiator, setIsInitiator] = useState(false);
  const [connectionState, setConnectionState] = useState('new');
  const [callRequestTimeout, setCallRequestTimeout] = useState(null);

  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerConnectionRef = useRef();
  const socketRef = useRef();
  const pendingCandidatesRef = useRef([]);
  const { endCall: endCallContext } = useCallContext();

  // Enhanced ICE servers configuration
  const getIceServers = () => {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ];
  };

  useEffect(() => {
    const initializeCall = async () => {
      try {
        console.log('VideoCall: Initializing call...');
        
        // Get user media first
        if (!localStream) {
          try {
            console.log('VideoCall: Requesting media access');
            const stream = await navigator.mediaDevices.getUserMedia({
              video: callType === 'video',
              audio: true
            });
            setLocalStream(stream);

            if (localVideoRef.current) {
              localVideoRef.current.srcObject = stream;
            }
            console.log('VideoCall: Media access granted');
          } catch (mediaErr) {
            console.error('Media access error:', mediaErr);
            if (mediaErr.name === 'NotReadableError') {
              setError('Camera/microphone is already in use by another application. Please close other apps using your camera/microphone and try again.');
            } else {
              setError('Failed to access camera/microphone. Please check permissions.');
            }
            return;
          }
        }

        // Connect to socket
        console.log('VideoCall: Connecting to socket...');
        const socket = await getSocket();
        socketRef.current = socket;
        console.log('VideoCall: Socket connected successfully');

        // Set up socket event listeners
        const setupEventListeners = () => {
          socket.on('callAccepted', handleCallAccepted);
          socket.on('callRejected', handleCallRejected);
          socket.on('callEnded', handleCallEnded);
          socket.on('callSignal', handleCallSignal);
          socket.on('userBusy', handleUserBusy);
          socket.on('callRequestSent', handleCallRequestSent);
        };

        setupEventListeners();
        console.log('VideoCall: Event listeners set up successfully');

        return () => {
          console.log('VideoCall: Cleaning up event listeners');
          if (socket) {
            socket.off('callAccepted', handleCallAccepted);
            socket.off('callRejected', handleCallRejected);
            socket.off('callEnded', handleCallEnded);
            socket.off('callSignal', handleCallSignal);
            socket.off('userBusy', handleUserBusy);
            socket.off('callRequestSent', handleCallRequestSent);
          }
        };
      } catch (err) {
        console.error('VideoCall: Initialization error:', err);
        setError('Failed to initialize call. Please check your connection and try again.');
      }
    };

    initializeCall();

    return () => {
      cleanup();
    };
  }, [callType]);

  const cleanup = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    pendingCandidatesRef.current = [];
    
    // Clear any pending timeout
    if (callRequestTimeout) {
      clearTimeout(callRequestTimeout);
      setCallRequestTimeout(null);
    }
  };

  const createPeerConnection = () => {
    // Clean up existing connection if any
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    const configuration = {
      iceServers: getIceServers(),
      iceCandidatePoolSize: 10
    };

    const peerConnection = new RTCPeerConnection(configuration);
    
    // Add local stream tracks to peer connection
    if (localStream) {
      localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream);
      });
    }

    // Handle incoming streams
    peerConnection.ontrack = (event) => {
      console.log('Received remote stream');
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate');
        const targetUserId = isInitiator ? otherUser._id : (caller ? caller._id : null);
        if (targetUserId && socketRef.current && socketRef.current.connected) {
          socketRef.current.emit('callSignal', {
            signal: { type: 'candidate', candidate: event.candidate },
            to: targetUserId
          });
        } else if (targetUserId) {
          console.error('VideoCall: Cannot send ICE candidate - socket not available');
        }
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state changed:', peerConnection.connectionState);
      setConnectionState(peerConnection.connectionState);
      
      if (peerConnection.connectionState === 'connected') {
        setIsCallActive(true);
        setIsConnecting(false);
        console.log('WebRTC connection established successfully');
      } else if (peerConnection.connectionState === 'failed') {
        setError('Connection failed. Please check your network connection and try again.');
        setIsConnecting(false);
      } else if (peerConnection.connectionState === 'closed') {
        setIsCallActive(false);
        setIsConnecting(false);
      } else if (peerConnection.connectionState === 'connecting') {
        setIsConnecting(true);
      }
    };

    // Handle signaling state changes
    peerConnection.onsignalingstatechange = () => {
      console.log('Signaling state:', peerConnection.signalingState);
    };

    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state:', peerConnection.iceConnectionState);
    };

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  };

  const handleCallRequestSent = () => {
    console.log('Call request sent successfully');
    // Set a timeout to handle cases where the call request doesn't get a response
    const timeout = setTimeout(() => {
      console.log('Call request timeout - no response received');
      setError('Call request timed out. The other user may be offline or not responding.');
      setIsConnecting(false);
    }, 30000); // 30 seconds timeout
    
    setCallRequestTimeout(timeout);
  };

  const handleCallAccepted = async (data) => {
    console.log('Call accepted by:', data.from);
    
    // Clear the timeout since we got a response
    if (callRequestTimeout) {
      clearTimeout(callRequestTimeout);
      setCallRequestTimeout(null);
    }
    
    setIsConnecting(true);
    setIsInitiator(true);
    
    const peerConnection = createPeerConnection();
    
    try {
      console.log('Creating offer for accepted call');
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video'
      });
      
      await peerConnection.setLocalDescription(offer);
      
      // Wait a bit before sending the offer to ensure proper state
      setTimeout(() => {
        if (socketRef.current && socketRef.current.connected) {
          socketRef.current.emit('callSignal', {
            signal: { type: 'offer', sdp: offer.sdp },
            to: data.from
          });
        } else {
          console.error('VideoCall: Cannot send offer - socket not available');
        }
      }, 100);
      
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('Failed to create call offer');
    }
  };

  const handleCallRejected = () => {
    console.log('Call was rejected');
    
    // Clear the timeout since we got a response
    if (callRequestTimeout) {
      clearTimeout(callRequestTimeout);
      setCallRequestTimeout(null);
    }
    
    setError('Call was rejected');
    onClose();
  };

  const handleCallEnded = () => {
    console.log('Call ended');
    handleEndCall();
  };

  const handleCallSignal = async (data) => {
    if (!peerConnectionRef.current) {
      console.log('No peer connection available');
      return;
    }

    try {
      const { signal } = data;
      console.log('Received signal:', signal.type, 'Current state:', peerConnectionRef.current.signalingState);
      
      if (signal.type === 'offer') {
        // Handle offer
        if (peerConnectionRef.current.signalingState === 'stable') {
          console.log('Setting remote description (offer)');
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signal));
          
          console.log('Creating answer');
          const answer = await peerConnectionRef.current.createAnswer();
          await peerConnectionRef.current.setLocalDescription(answer);
          
          // Add any pending candidates
          while (pendingCandidatesRef.current.length > 0) {
            const candidate = pendingCandidatesRef.current.shift();
            try {
              await peerConnectionRef.current.addIceCandidate(candidate);
            } catch (err) {
              console.error('Error adding pending candidate:', err);
            }
          }
          
          console.log('Sending answer');
          if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('callSignal', {
              signal: { type: 'answer', sdp: answer.sdp },
              to: data.from
            });
          } else {
            console.error('VideoCall: Cannot send answer - socket not available');
          }
        } else {
          console.warn('Ignoring offer: not in stable state');
        }
      } else if (signal.type === 'answer') {
        // Handle answer
        console.log('Setting remote description (answer)');
        if (peerConnectionRef.current.signalingState === 'have-local-offer') {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(signal));
          
          // Add any pending candidates
          while (pendingCandidatesRef.current.length > 0) {
            const candidate = pendingCandidatesRef.current.shift();
            try {
              await peerConnectionRef.current.addIceCandidate(candidate);
            } catch (err) {
              console.error('Error adding pending candidate:', err);
            }
          }
        } else {
          console.warn('Skipping setRemoteDescription(answer): wrong signaling state', peerConnectionRef.current.signalingState);
        }
      } else if (signal.type === 'candidate') {
        // Handle ICE candidate
        console.log('Adding ICE candidate');
        if (peerConnectionRef.current.remoteDescription) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.error('Error adding ICE candidate:', err);
          }
        } else {
          console.log('Storing candidate for later');
          pendingCandidatesRef.current.push(new RTCIceCandidate(signal.candidate));
        }
      }
    } catch (err) {
      console.error('Error handling signal:', err);
      setError('Connection error occurred: ' + err.message);
    }
  };

  const handleUserBusy = (data) => {
    console.log('User is busy:', data);
    
    // Clear the timeout since we got a response
    if (callRequestTimeout) {
      clearTimeout(callRequestTimeout);
      setCallRequestTimeout(null);
    }
    
    setError(data.reason || 'User is busy');
    onClose();
  };

  const initiateCall = async () => {
    try {
      console.log('VideoCall: Initiating call to:', otherUser._id);
      console.log('VideoCall: Current user:', currentUser._id);
      console.log('VideoCall: Call type:', callType);
      setIsConnecting(true);
      setIsInitiator(true);
      
      // Ensure socket is available
      if (!socketRef.current) {
        console.log('VideoCall: Socket not available, attempting to connect...');
        try {
          const socket = await getSocket();
          socketRef.current = socket;
        } catch (socketErr) {
          console.error('VideoCall: Failed to connect socket:', socketErr);
          setError('Failed to connect to server. Please check your connection and try again.');
          setIsConnecting(false);
          return;
        }
      }
      
      // Send the call request
      console.log('VideoCall: Sending callRequest event');
      if (socketRef.current && socketRef.current.connected) {
        console.log('VideoCall: Socket is connected, emitting callRequest');
        socketRef.current.emit('callRequest', {
          to: otherUser._id,
          from: currentUser._id,
          type: callType
        });
        console.log('VideoCall: callRequest event emitted successfully');
      } else {
        console.error('VideoCall: Socket is not connected');
        setError('Socket connection not available. Please refresh the page and try again.');
        setIsConnecting(false);
        return;
      }
      
      // Create peer connection after sending request
      createPeerConnection();
      
    } catch (err) {
      console.error('VideoCall: Call initiation error:', err);
      setError('Failed to initiate call. Please try again.');
      setIsConnecting(false);
    }
  };

  const acceptCall = () => {
    console.log('Accepting call');
    setIsIncomingCallState(false);
    setIsConnecting(true);
    setIsInitiator(false);
    createPeerConnection();
    
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('callAccepted', {
        to: caller._id,
        from: currentUser._id
      });
    } else {
      console.error('VideoCall: Cannot accept call - socket not available');
      setError('Socket connection not available. Please refresh the page and try again.');
    }
  };

  const rejectCall = () => {
    console.log('Rejecting call');
    setIsIncomingCallState(false);
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('callRejected', {
        to: caller._id,
        from: currentUser._id
      });
    } else {
      console.error('VideoCall: Cannot reject call - socket not available');
    }
    onClose();
  };

  const handleEndCall = () => {
    console.log('Ending call');
    cleanup();
    setIsCallActive(false);
    setIsConnecting(false);
    setRemoteStream(null);
    
    const targetUserId = isIncomingCallState ? caller._id : otherUser._id;
    if (targetUserId && socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('callEnded', {
        to: targetUserId,
        from: currentUser._id
      });
    } else if (targetUserId) {
      console.error('VideoCall: Cannot end call - socket not available');
    }
    
    endCallContext();
    onClose();
  };

  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
  };

  // Auto-initiate call if not incoming
  useEffect(() => {
    if (!isIncomingCallState && !isCallActive && !isConnecting) {
      initiateCall();
    }
  }, []);

  // Debug panel for troubleshooting
  const DebugPanel = () => {
    if (!import.meta.env.DEV) return null;
    
    return (
      <div className="absolute top-4 left-4 bg-black bg-opacity-75 text-white p-4 rounded text-xs max-w-xs">
        <h4 className="font-bold mb-2">Debug Info</h4>
        <div>Socket: {socketRef.current?.connected ? 'Connected' : 'Disconnected'}</div>
        <div>Connection State: {connectionState}</div>
        <div>Is Initiator: {isInitiator ? 'Yes' : 'No'}</div>
        <div>Local Stream: {localStream ? 'Active' : 'None'}</div>
        <div>Remote Stream: {remoteStream ? 'Active' : 'None'}</div>
        <div>Peer Connection: {peerConnectionRef.current ? 'Active' : 'None'}</div>
        {peerConnectionRef.current && (
          <div>Signaling State: {peerConnectionRef.current.signalingState}</div>
        )}
        <div>Pending Candidates: {pendingCandidatesRef.current.length}</div>
      </div>
    );
  };

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
          <h3 className="text-lg font-semibold mb-4">Call Error</h3>
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={onClose}
            className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (isIncomingCallState) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
          <h3 className="text-xl font-semibold mb-2">Incoming {callType === 'video' ? 'Video' : 'Voice'} Call</h3>
          <p className="text-gray-600 mb-6">{caller?.username || 'Unknown'}</p>
          <div className="flex gap-4">
            <button
              onClick={acceptCall}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={rejectCall}
              className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
      {/* Debug Panel */}
      <DebugPanel />
      
      {/* Remote Video */}
      <div className="flex-1 relative">
        {remoteStream ? (
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center text-white">
              <div className="text-4xl mb-4">📞</div>
              <p className="text-lg">
                {isConnecting ? 'Connecting...' : 'Waiting for connection...'}
              </p>
              <p className="text-sm text-gray-400 mt-2">
                {connectionState === 'connecting' && 'Establishing connection...'}
                {connectionState === 'connected' && 'Connected!'}
                {connectionState === 'failed' && 'Connection failed'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Local Video */}
      <div className="absolute top-4 right-4 w-32 h-24 bg-gray-800 rounded-lg overflow-hidden">
        {localStream && (
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-cover"
          />
        )}
      </div>

      {/* Controls */}
      <div className="bg-black bg-opacity-50 p-4">
        <div className="flex justify-center items-center gap-4">
          <button
            onClick={toggleMute}
            className={`p-3 rounded-full ${isMuted ? 'bg-red-600' : 'bg-gray-600'} text-white hover:opacity-80`}
          >
            {isMuted ? '🔇' : '🎤'}
          </button>
          
          {callType === 'video' && (
            <button
              onClick={toggleVideo}
              className={`p-3 rounded-full ${isVideoOff ? 'bg-red-600' : 'bg-gray-600'} text-white hover:opacity-80`}
            >
              {isVideoOff ? '📷' : '📹'}
            </button>
          )}
          
          <button
            onClick={handleEndCall}
            className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700"
          >
            📞
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoCall;