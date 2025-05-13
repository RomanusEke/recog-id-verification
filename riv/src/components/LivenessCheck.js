import React, { useState, useEffect } from 'react';
import './LivenessCheck.css';

const LivenessCheck = ({ onComplete, user }) => {
  const [sessionId, setSessionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('initializing');

  useEffect(() => {
    const initializeLivenessCheck = async () => {
      try {
        setStatus('creating_session');
        
        // Get session details from backend
        const response = await fetch(process.env.REACT_APP_API_URL + '/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${(await Auth.currentSession()).getIdToken().getJwtToken()}`
          },
          body: JSON.stringify({
            action: 'start_liveness_session',
            userId: user.username
          })
        });
        
        if (!response.ok) {
          throw new Error('Failed to initialize liveness check');
        }
        
        const data = await response.json();
        setSessionId(data.sessionId);
        setIsLoading(false);
        setStatus('ready');
      } catch (err) {
        console.error('Liveness check initialization error:', err);
        setError('Failed to initialize liveness check. Please try again.');
        setStatus('error');
        setIsLoading(false);
      }
    };

    initializeLivenessCheck();
  }, [user]);

  const startLivenessCheck = () => {
    if (!sessionId) return;
    
    setStatus('in_progress');
    
    // Initialize AWS Rekognition Liveness SDK
    const livenessCheck = new window.LivenessCheck({
      sessionId,
      region: process.env.REACT_APP_REGION,
      onComplete: async (result) => {
        if (result.isLive) {
          try {
            setStatus('verifying');
            
            // Verify liveness results with backend
            const verifyResponse = await fetch(process.env.REACT_APP_API_URL + '/verify', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${(await Auth.currentSession()).getIdToken().getJwtToken()}`
              },
              body: JSON.stringify({
                action: 'verify_liveness',
                sessionId,
                userId: user.username
              })
            });
            
            if (!verifyResponse.ok) {
              throw new Error('Liveness verification failed');
            }
            
            const verificationData = await verifyResponse.json();
            onComplete(verificationData);
            setStatus('complete');
          } catch (err) {
            console.error('Verification error:', err);
            setError('Verification failed. Please try again.');
            setStatus('error');
          }
        } else {
          setError('Liveness check failed. Please try again.');
          setStatus('error');
        }
      },
      onError: (error) => {
        console.error('Liveness check error:', error);
        setError('An error occurred during liveness check. Please try again.');
        setStatus('error');
      }
    });
    
    livenessCheck.start();
  };

  return (
    <div className="liveness-check">
      <h2>Step 2: Face Liveness Verification</h2>
      <p>We need to verify that you're a real person. Please follow the instructions on screen.</p>
      
      {isLoading ? (
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Initializing liveness check...</p>
        </div>
      ) : error ? (
        <div className="error-message">
          <p>{error}</p>
          <button onClick={() => window.location.reload()}>Try Again</button>
        </div>
      ) : status === 'ready' ? (
        <div className="liveness-start">
          <button onClick={startLivenessCheck} className="start-button">
            Start Liveness Check
          </button>
          <div className="instructions">
            <h3>Instructions:</h3>
            <ul>
              <li>Ensure good lighting</li>
              <li>Remove sunglasses or hats</li>
              <li>Position your face in the frame</li>
              <li>Follow the on-screen prompts</li>
            </ul>
          </div>
        </div>
      ) : status === 'in_progress' ? (
        <div className="liveness-container" id="liveness-container"></div>
      ) : status === 'verifying' ? (
        <div className="verifying-message">
          <div className="spinner"></div>
          <p>Verifying your identity...</p>
        </div>
      ) : null}
    </div>
  );
};

export default LivenessCheck;