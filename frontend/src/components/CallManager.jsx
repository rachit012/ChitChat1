import React, { useState, useEffect } from 'react';
import { getSocket } from '../utils/socket';
import VideoCall from './VideoCall';

const CallManager = ({ currentUser }) => {
  const [incomingCall, setIncomingCall] = useState(null);
  const [activeCall, setActiveCall] = useState(null);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const initializeCallManager = async () => {
      try {
        const socketInstance = await getSocket();
        setSocket(socketInstance);

        // Handle incoming call requests
        const handleCallRequest = (data) => {
          console.log('Received call request:', data);
          setIncomingCall({
            caller: data.caller,
            type: data.type
          });
        };

        // Handle call accepted (for caller)
        const handleCallAccepted = (data) => {
          console.log('Call accepted:', data);
          setActiveCall({
            otherUser: { _id: data.from },
            type: 'video',
            isIncoming: false
          });
        };

        // Handle call rejected
        const handleCallRejected = () => {
          setIncomingCall(null);
          setActiveCall(null);
        };

        // Handle call ended
        const handleCallEnded = () => {
          setIncomingCall(null);
          setActiveCall(null);
        };

        // Set up event listeners
        socketInstance.on('callRequest', handleCallRequest);
        socketInstance.on('callAccepted', handleCallAccepted);
        socketInstance.on('callRejected', handleCallRejected);
        socketInstance.on('callEnded', handleCallEnded);

        return () => {
          socketInstance.off('callRequest', handleCallRequest);
          socketInstance.off('callAccepted', handleCallAccepted);
          socketInstance.off('callRejected', handleCallRejected);
          socketInstance.off('callEnded', handleCallEnded);
        };
      } catch (err) {
        console.error('CallManager initialization error:', err);
      }
    };

    if (currentUser && currentUser._id) {
      initializeCallManager();
    }
  }, [currentUser?._id]);

  const handleAcceptCall = () => {
    if (incomingCall && socket) {
      socket.emit('callAccepted', {
        to: incomingCall.caller._id,
        from: currentUser._id
      });
      
      setActiveCall({
        otherUser: incomingCall.caller,
        type: incomingCall.type,
        isIncoming: true
      });
      
      setIncomingCall(null);
    }
  };

  const handleRejectCall = () => {
    if (incomingCall && socket) {
      socket.emit('callRejected', {
        to: incomingCall.caller._id,
        from: currentUser._id
      });
    }
    setIncomingCall(null);
    setActiveCall(null);
  };

  const handleCloseActiveCall = () => {
    setActiveCall(null);
  };

  // Show incoming call dialog
  if (incomingCall) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
          <h3 className="text-xl font-semibold mb-2">
            Incoming {incomingCall.type === 'video' ? 'Video' : 'Voice'} Call
          </h3>
          <p className="text-gray-600 mb-6">{incomingCall.caller?.username || 'Unknown'}</p>
          <div className="flex gap-4">
            <button
              onClick={handleAcceptCall}
              className="flex-1 bg-green-600 text-white py-3 rounded-lg hover:bg-green-700"
            >
              Accept
            </button>
            <button
              onClick={handleRejectCall}
              className="flex-1 bg-red-600 text-white py-3 rounded-lg hover:bg-red-700"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show active call
  if (activeCall) {
    return (
      <VideoCall
        currentUser={currentUser}
        otherUser={activeCall.otherUser}
        callType={activeCall.type}
        isIncomingCallProp={activeCall.isIncoming}
        onClose={handleCloseActiveCall}
      />
    );
  }

  return null;
};

export default CallManager; 