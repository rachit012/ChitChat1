import React, { useState, useEffect } from 'react';
import { getSocket } from '../utils/socket';
import VideoCall from './VideoCall';
import GroupVideoCall from './GroupVideoCall';
import { useCallContext } from '../contexts/CallContext';

const CallManager = ({ currentUser }) => {
  const [incomingCall, setIncomingCall] = useState(null);
  const [socket, setSocket] = useState(null);
  const { isCallActive, startCall, endCall } = useCallContext();

  useEffect(() => {
    const initializeCallManager = async () => {
      try {
        const socketInstance = await getSocket();
        setSocket(socketInstance);

        console.log('CallManager: Setting up global call event listeners');

        // Global call event listeners
        const handleCallRequest = (data) => {
          console.log('CallManager: Received callRequest event:', data);
          console.log('CallManager: Current user ID:', currentUser._id);
          console.log('CallManager: Caller ID:', data.caller._id);
          console.log('CallManager: Is call active:', isCallActive);
          
          if (!isCallActive) {
            console.log('CallManager: Setting incoming call state');
            setIncomingCall({
              caller: data.caller,
              type: data.type,
              isIncoming: true,
              isGroupCall: false
            });
          } else {
            console.log('CallManager: User is busy, sending busy signal');
            // Send busy signal if already in a call
            socketInstance.emit('userBusy', {
              to: data.caller._id,
              from: currentUser._id
            });
          }
        };

        const handleGroupCallRequest = (data) => {
          console.log('CallManager: Received groupCallRequest event:', data);
          if (!isCallActive) {
            setIncomingCall({
              caller: data.caller,
              type: data.type,
              isIncoming: true,
              isGroupCall: true,
              roomId: data.roomId
            });
          } else {
            // Send busy signal if already in a call
            socketInstance.emit('userBusy', {
              to: data.caller._id,
              from: currentUser._id
            });
          }
        };

        const handleCallAccepted = (data) => {
          console.log('CallManager: Received callAccepted event:', data);
          startCall('video'); // or get the actual call type from data
        };

        const handleCallRejected = (data) => {
          console.log('CallManager: Received callRejected event:', data);
          setIncomingCall(null);
        };

        const handleCallEnded = (data) => {
          console.log('CallManager: Received callEnded event:', data);
          setIncomingCall(null);
          endCall();
        };

        const handleGroupCallAccepted = (data) => {
          console.log('CallManager: Received groupCallAccepted event:', data);
          startCall('video');
        };

        const handleGroupCallRejected = (data) => {
          console.log('CallManager: Received groupCallRejected event:', data);
          setIncomingCall(null);
        };

        const handleGroupCallEnded = (data) => {
          console.log('CallManager: Received groupCallEnded event:', data);
          setIncomingCall(null);
          endCall();
        };

        // Set up event listeners
        socketInstance.on('callRequest', handleCallRequest);
        socketInstance.on('groupCallRequest', handleGroupCallRequest);
        socketInstance.on('callAccepted', handleCallAccepted);
        socketInstance.on('callRejected', handleCallRejected);
        socketInstance.on('callEnded', handleCallEnded);
        socketInstance.on('groupCallAccepted', handleGroupCallAccepted);
        socketInstance.on('groupCallRejected', handleGroupCallRejected);
        socketInstance.on('groupCallEnded', handleGroupCallEnded);

        console.log('CallManager: Global call event listeners set up successfully');

        return () => {
          console.log('CallManager: Cleaning up global call event listeners');
          socketInstance.off('callRequest', handleCallRequest);
          socketInstance.off('groupCallRequest', handleGroupCallRequest);
          socketInstance.off('callAccepted', handleCallAccepted);
          socketInstance.off('callRejected', handleCallRejected);
          socketInstance.off('callEnded', handleCallEnded);
          socketInstance.off('groupCallAccepted', handleGroupCallAccepted);
          socketInstance.off('groupCallRejected', handleGroupCallRejected);
          socketInstance.off('groupCallEnded', handleGroupCallEnded);
        };
      } catch (err) {
        console.error('CallManager: Failed to initialize:', err);
      }
    };

    initializeCallManager();
  }, [currentUser._id, isCallActive, startCall, endCall]);

  const handleAcceptCall = () => {
    if (incomingCall) {
      if (incomingCall.isGroupCall) {
        // Handle group call acceptance
        if (socket) {
          socket.emit('groupCallAccepted', {
            roomId: incomingCall.roomId,
            to: incomingCall.caller._id,
            from: currentUser._id
          });
        }
      } else {
        // Handle individual call acceptance
        if (socket) {
          socket.emit('callAccepted', {
            to: incomingCall.caller._id,
            from: currentUser._id
          });
        }
      }
      setIncomingCall(null);
    }
  };

  const handleRejectCall = () => {
    if (incomingCall) {
      if (incomingCall.isGroupCall) {
        // Handle group call rejection
        if (socket) {
          socket.emit('groupCallRejected', {
            roomId: incomingCall.roomId,
            to: incomingCall.caller._id,
            from: currentUser._id
          });
        }
      } else {
        // Handle individual call rejection
        if (socket) {
          socket.emit('callRejected', {
            to: incomingCall.caller._id,
            from: currentUser._id
          });
        }
      }
      setIncomingCall(null);
    }
  };

  const handleCloseIncomingCall = () => {
    setIncomingCall(null);
  };

  if (incomingCall) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4 text-center">
          <h3 className="text-xl font-semibold mb-2">
            Incoming {incomingCall.isGroupCall ? 'Group ' : ''}{incomingCall.type === 'video' ? 'Video' : 'Voice'} Call
          </h3>
          <p className="text-gray-600 mb-2">{incomingCall.caller?.username || 'Unknown'}</p>
          {incomingCall.isGroupCall && (
            <p className="text-gray-500 mb-6">Room: {incomingCall.roomId || 'Unknown Room'}</p>
          )}
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
          <button
            onClick={handleCloseIncomingCall}
            className="mt-4 text-gray-500 hover:text-gray-700"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return null;
};

export default CallManager; 