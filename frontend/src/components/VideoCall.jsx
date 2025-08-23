import React, { useState, useEffect, useRef } from 'react';
import { getSocket } from '../utils/socket';

const VideoCall = ({ currentUser, otherUser, onClose, callType = 'video', isIncomingCallProp = false }) => {
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [isCallActive, setIsCallActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const localVideoRef = useRef();
  const remoteVideoRef = useRef();
  const peerConnectionRef = useRef();
  const socketRef = useRef();
  const pendingCandidatesRef = useRef([]);

  // Initialize call
  useEffect(() => {
    const initCall = async () => {
      try {
        // Get user media
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callType === 'video',
          audio: true
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }

        // Connect to socket
        const socket = await getSocket();
        socketRef.current = socket;

        // Set up event listeners
        socket.on('callAccepted', handleCallAccepted);
        socket.on('callRejected', handleCallRejected);
        socket.on('callEnded', handleCallEnded);
        socket.on('callSignal', handleCallSignal);

        // If outgoing call, initiate it
        if (!isIncomingCallProp) {
          initiateCall();
        }

        return () => {
          socket.off('callAccepted', handleCallAccepted);
          socket.off('callRejected', handleCallRejected);
          socket.off('callEnded', handleCallEnded);
          socket.off('callSignal', handleCallSignal);
        };
      } catch (err) {
        console.error('Call initialization error:', err);
        setError('Failed to start call: ' + err.message);
      }
    };

    initCall();
  }, []);

  // Create peer connection
  const createPeerConnection = () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    
    // Add local stream
    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    // Handle incoming stream
    pc.ontrack = (event) => {
      setRemoteStream(event.streams[0]);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('callSignal', {
          signal: { type: 'candidate', candidate: event.candidate },
          to: otherUser._id
        });
      }
    };

    // Handle connection state
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        setIsCallActive(true);
        setIsConnecting(false);
      } else if (pc.connectionState === 'failed') {
        setError('Connection failed');
        setIsConnecting(false);
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  // Initiate call (caller only)
  const initiateCall = async () => {
    if (!socketRef.current) return;
    
    setIsConnecting(true);
    socketRef.current.emit('callRequest', {
      to: otherUser._id,
      from: currentUser._id,
      type: callType
    });
  };

  // Handle call accepted (caller only)
  const handleCallAccepted = async (data) => {
    if (isIncomingCallProp) return; // Only caller handles this
    
    console.log('Caller: Call accepted, creating offer');
    setIsConnecting(true);
    
    const pc = createPeerConnection();
    
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      console.log('Caller: Sending offer to callee');
      socketRef.current.emit('callSignal', {
        signal: { type: 'offer', sdp: offer.sdp },
        to: otherUser._id
      });
    } catch (err) {
      console.error('Error creating offer:', err);
      setError('Failed to create call offer');
    }
  };

  // Handle call rejected
  const handleCallRejected = () => {
    setError('Call was rejected');
    onClose();
  };

  // Handle call ended
  const handleCallEnded = () => {
    endCall();
  };

  // Handle call signals
  const handleCallSignal = async (data) => {
    const { signal } = data;
    
    try {
      if (signal.type === 'offer') {
        // Callee receives offer
        if (!isIncomingCallProp) return; // Only callee should handle offers
        
        const pc = createPeerConnection();
        
        await pc.setRemoteDescription(new RTCSessionDescription(signal));
        
        // Add any pending candidates
        while (pendingCandidatesRef.current.length > 0) {
          const candidate = pendingCandidatesRef.current.shift();
          try {
            await pc.addIceCandidate(candidate);
          } catch (err) {
            console.error('Error adding pending candidate:', err);
          }
        }
        
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        socketRef.current.emit('callSignal', {
          signal: { type: 'answer', sdp: answer.sdp },
          to: otherUser._id
        });
      } else if (signal.type === 'answer') {
        // Caller receives answer
        if (isIncomingCallProp) return; // Only caller should handle answers
        
        if (peerConnectionRef.current) {
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
        }
      } else if (signal.type === 'candidate') {
        // Handle ICE candidate
        if (peerConnectionRef.current && peerConnectionRef.current.remoteDescription) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate));
          } catch (err) {
            console.error('Error adding ICE candidate:', err);
          }
        } else {
          // Store for later
          pendingCandidatesRef.current.push(new RTCIceCandidate(signal.candidate));
        }
      }
    } catch (err) {
      console.error('Error handling signal:', err);
    }
  };

  // End call
  const endCall = () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    if (socketRef.current) {
      socketRef.current.emit('callEnded', {
        to: otherUser._id,
        from: currentUser._id
      });
    }
    onClose();
  };

  // Toggle mute
  const toggleMute = () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMuted(!audioTrack.enabled);
      }
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStream) {
      const videoTrack = localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
      }
    }
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

  return (
    <div className="fixed inset-0 bg-black flex flex-col z-50">
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
            onClick={endCall}
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