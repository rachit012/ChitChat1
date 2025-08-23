import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../utils/socket';
import { useCallContext } from '../contexts/CallContext';

const GroupVideoCall = ({ currentUser, room, onClose, callType = 'video', isIncomingCallProp = false }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [isCallActive, setIsCallActive] = useState(false);
  const [isIncomingCall, setIsIncomingCall] = useState(isIncomingCallProp);
  const [caller, setCaller] = useState(isIncomingCallProp ? null : null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [isInitiator, setIsInitiator] = useState(false);
  const [connectionStates, setConnectionStates] = useState(new Map());

  const localVideoRef = useRef();
  const peerConnectionsRef = useRef(new Map());
  const socketRef = useRef();
  const pendingCandidatesRef = useRef(new Map());
  const { endCall } = useCallContext();

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
        const socket = await getSocket();
        socketRef.current = socket;

        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === 'video',
          audio: true
        });
        setLocalStream(stream);

        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Socket event listeners
        const setupEventListeners = () => {
          socket.on('groupCallRequest', handleIncomingGroupCall);
          socket.on('groupCallAccepted', handleGroupCallAccepted);
          socket.on('groupCallRejected', handleGroupCallRejected);
          socket.on('groupCallEnded', handleGroupCallEnded);
          socket.on('groupCallSignal', handleGroupCallSignal);
          socket.on('userJoinedGroupCall', handleUserJoinedGroupCall);
          socket.on('userLeftGroupCall', handleUserLeftGroupCall);
        };

        setupEventListeners();

        return () => {
          socket.off('groupCallRequest', handleIncomingGroupCall);
          socket.off('groupCallAccepted', handleGroupCallAccepted);
          socket.off('groupCallRejected', handleGroupCallRejected);
          socket.off('groupCallEnded', handleGroupCallEnded);
          socket.off('groupCallSignal', handleGroupCallSignal);
          socket.off('userJoinedGroupCall', handleUserJoinedGroupCall);
          socket.off('userLeftGroupCall', handleUserLeftGroupCall);
        };
      } catch (err) {
        setError('Failed to access camera/microphone. Please check permissions.');
        console.error('Media access error:', err);
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
    peerConnectionsRef.current.forEach(connection => connection.close());
    peerConnectionsRef.current.clear();
    pendingCandidatesRef.current.clear();
  };

  const createPeerConnection = (targetUserId) => {
    // Clean up existing connection if any
    const existingConnection = peerConnectionsRef.current.get(targetUserId);
    if (existingConnection) {
      existingConnection.close();
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
      console.log('Received remote stream from:', targetUserId);
      setRemoteStreams(prev => {
        const newMap = new Map(prev);
        newMap.set(targetUserId, event.streams[0]);
        return newMap;
      });
    };

    // Handle ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('Sending ICE candidate to:', targetUserId);
        if (socketRef.current) {
          socketRef.current.emit('groupCallSignal', {
            signal: { type: 'candidate', candidate: event.candidate },
            to: targetUserId,
            roomId: room._id
          });
        }
      }
    };

    // Handle connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state changed for', targetUserId, ':', peerConnection.connectionState);
      setConnectionStates(prev => {
        const newMap = new Map(prev);
        newMap.set(targetUserId, peerConnection.connectionState);
        return newMap;
      });
      
      if (peerConnection.connectionState === 'connected') {
        setIsCallActive(true);
        setIsConnecting(false);
        console.log('WebRTC connection established with:', targetUserId);
      } else if (peerConnection.connectionState === 'failed') {
        setError('Connection failed with ' + targetUserId);
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
      console.log('Signaling state for', targetUserId, ':', peerConnection.signalingState);
    };

    // Handle ICE connection state changes
    peerConnection.oniceconnectionstatechange = () => {
      console.log('ICE connection state for', targetUserId, ':', peerConnection.iceConnectionState);
    };

    peerConnectionsRef.current.set(targetUserId, peerConnection);
    return peerConnection;
  };

  const handleIncomingGroupCall = (data) => {
    console.log('Incoming group call from:', data.caller);
    setCaller(data.caller);
    setIsIncomingCall(true);
    setIsInitiator(false);
  };

  const handleGroupCallAccepted = async (data) => {
    console.log('Group call accepted by:', data.from);
    setIsConnecting(true);
    setIsInitiator(false);
    
    const peerConnection = createPeerConnection(data.from);
    
    try {
      console.log('Creating offer for group call to:', data.from);
      const offer = await peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video'
      });
      
      if (peerConnection.signalingState === 'stable') {
        await peerConnection.setLocalDescription(offer);
        
        // Wait a bit before sending the offer to ensure proper state
        setTimeout(() => {
          if (socketRef.current) {
            socketRef.current.emit('groupCallSignal', {
              signal: { type: 'offer', sdp: offer.sdp },
              to: data.from,
              roomId: room._id
            });
          }
        }, 100);
      } else {
        console.warn('Skipping setLocalDescription(offer): wrong state:', peerConnection.signalingState);
      }
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('Failed to create call offer');
    }
  };

  const handleGroupCallRejected = () => {
    setError('Call was rejected');
    onClose();
  };

  const handleGroupCallEnded = () => {
    console.log('Group call ended');
    endCall();
  };

  const handleGroupCallSignal = async (data) => {
    const peerConnection = peerConnectionsRef.current.get(data.from);
    if (!peerConnection) {
      console.log('No peer connection available for:', data.from);
      return;
    }

    try {
      const { signal } = data;
      console.log('Received signal from', data.from, ':', signal.type, 'Current state:', peerConnection.signalingState);
      
      if (signal.type === 'offer') {
        // Handle offer
        if (peerConnection.signalingState === 'stable') {
          console.log('Setting remote description (offer) for', data.from);
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
          
          console.log('Creating answer for', data.from);
          const answer = await peerConnection.createAnswer();
          await peerConnection.setLocalDescription(answer);
          
          // Add any pending candidates
          const pendingCandidates = pendingCandidatesRef.current.get(data.from) || [];
          while (pendingCandidates.length > 0) {
            const candidate = pendingCandidates.shift();
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (err) {
              console.error('Error adding pending candidate:', err);
            }
          }
          pendingCandidatesRef.current.set(data.from, pendingCandidates);
          
          console.log('Sending answer to', data.from);
          if (socketRef.current) {
            socketRef.current.emit('groupCallSignal', {
              signal: { type: 'answer', sdp: answer.sdp },
              to: data.from,
              roomId: room._id
            });
          }
        } else {
          console.warn('Ignoring offer: not in stable state for', data.from);
        }
      } else if (signal.type === 'answer') {
        // Handle answer
        console.log('Setting remote description (answer) for', data.from);
        if (peerConnection.signalingState === 'have-local-offer') {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
          
          // Add any pending candidates
          const pendingCandidates = pendingCandidatesRef.current.get(data.from) || [];
          while (pendingCandidates.length > 0) {
            const candidate = pendingCandidates.shift();
            try {
              await peerConnection.addIceCandidate(candidate);
            } catch (err) {
              console.error('Error adding pending candidate:', err);
            }
          }
          pendingCandidatesRef.current.set(data.from, pendingCandidates);
        } else {
          console.warn('Skipping setRemoteDescription(answer): wrong signaling state', peerConnection.signalingState);
        }
      } else if (signal.type === 'candidate') {
        // Handle ICE candidate
        console.log('Adding ICE candidate for', data.from);
        if (peerConnection.remoteDescription) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.error('Error adding ICE candidate:', err);
          }
        } else {
          console.log('Storing candidate for later for', data.from);
          const pendingCandidates = pendingCandidatesRef.current.get(data.from) || [];
          pendingCandidates.push(new RTCIceCandidate(signal.candidate));
          pendingCandidatesRef.current.set(data.from, pendingCandidates);
        }
      }
    } catch (err) {
      console.error('Error handling signal:', err);
      setError('Connection error occurred: ' + err.message);
    }
  };

  const handleUserJoinedGroupCall = (data) => {
    console.log('User joined group call:', data.userId);
    // Create peer connection for new user
    createPeerConnection(data.userId);
  };

  const handleUserLeftGroupCall = (data) => {
    console.log('User left group call:', data.userId);
    // Clean up peer connection
    const peerConnection = peerConnectionsRef.current.get(data.userId);
    if (peerConnection) {
      peerConnection.close();
      peerConnectionsRef.current.delete(data.userId);
    }
    
    // Remove remote stream
    setRemoteStreams(prev => {
      const newMap = new Map(prev);
      newMap.delete(data.userId);
      return newMap;
    });
    
    // Remove connection state
    setConnectionStates(prev => {
      const newMap = new Map(prev);
      newMap.delete(data.userId);
      return newMap;
    });
  };

  const initiateGroupCall = async () => {
    try {
      console.log('Initiating group call in room:', room._id);
      setIsConnecting(true);
      setIsInitiator(true);
      
      if (socketRef.current) {
        socketRef.current.emit('groupCallRequest', {
          roomId: room._id,
          from: currentUser._id,
          type: callType
        });
      }
      
    } catch (err) {
      setError('Failed to initiate group call');
      console.error('Group call initiation error:', err);
    }
  };

  const acceptGroupCall = () => {
    console.log('Accepting group call');
    setIsIncomingCall(false);
    setIsConnecting(true);
    setIsInitiator(false);
    
    if (socketRef.current) {
      socketRef.current.emit('groupCallAccepted', {
        roomId: room._id,
        to: caller._id,
        from: currentUser._id
      });
    }
  };

  const rejectGroupCall = () => {
    console.log('Rejecting group call');
    setIsIncomingCall(false);
    if (socketRef.current) {
      socketRef.current.emit('groupCallRejected', {
        roomId: room._id,
        to: caller._id,
        from: currentUser._id
      });
    }
    onClose();
  };

  const endGroupCall = () => {
    console.log('Ending group call');
    cleanup();
    setIsCallActive(false);
    setIsConnecting(false);
    setRemoteStreams(new Map());
    
    if (socketRef.current) {
      socketRef.current.emit('groupCallEnded', {
        roomId: room._id,
        from: currentUser._id
      });
    }
    
    endCall();
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
    if (!isIncomingCall && !isCallActive && !isConnecting) {
      initiateGroupCall();
    }
  }, []);

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

  if (isIncomingCall) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
          <h3 className="text-xl font-semibold mb-2">Incoming Group {callType === 'video' ? 'Video' : 'Voice'} Call</h3>
          <p className="text-gray-600 mb-2">{caller?.username || 'Unknown'}</p>
          <p className="text-gray-500 mb-6">Room: {room?.name || 'Unknown Room'}</p>
          <div className="flex gap-4">
            <button
              onClick={acceptGroupCall}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={rejectGroupCall}
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
      {/* Remote Videos Grid */}
      <div className="flex-1 p-4">
        {remoteStreams.size > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 h-full">
            {Array.from(remoteStreams.entries()).map(([userId, stream]) => (
              <div key={userId} className="relative bg-gray-800 rounded-lg overflow-hidden">
                <video
                  autoPlay
                  playsInline
                  className="w-full h-full object-cover"
                  ref={(el) => {
                    if (el) el.srcObject = stream;
                  }}
                />
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded text-sm">
                  User {userId.slice(-4)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center text-white">
              <div className="text-4xl mb-4">📞</div>
              <p className="text-lg">
                {isConnecting ? 'Connecting...' : 'Waiting for participants...'}
              </p>
              <p className="text-sm text-gray-400 mt-2">
                {Array.from(connectionStates.values()).some(state => state === 'connecting') && 'Establishing connections...'}
                {Array.from(connectionStates.values()).some(state => state === 'connected') && 'Connected!'}
                {Array.from(connectionStates.values()).some(state => state === 'failed') && 'Some connections failed'}
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
            onClick={endGroupCall}
            className="p-3 rounded-full bg-red-600 text-white hover:bg-red-700"
          >
            📞
          </button>
        </div>
      </div>
    </div>
  );
};

export default GroupVideoCall; 