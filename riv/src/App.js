import React, { useState } from 'react';
import { Amplify, Auth } from 'aws-amplify';
import { withAuthenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import DocumentUpload from './components/DocumentUpload';
import LivenessCheck from './components/LivenessCheck';
import VerificationStatus from './components/VerificationStatus';
import './App.css';

Amplify.configure({
  Auth: {
    region: process.env.REACT_APP_REGION,
    userPoolId: process.env.REACT_APP_USER_POOL_ID,
    userPoolWebClientId: process.env.REACT_APP_CLIENT_ID,
  },
});

function App({ signOut, user }) {
  const [verificationStep, setVerificationStep] = useState(1);
  const [verificationData, setVerificationData] = useState(null);

  const handleVerificationComplete = (data) => {
    setVerificationData(data);
    setVerificationStep(3);
  };

  return (
    <div className="App">
      <header className="App-header">
        <h1>Identity Verification</h1>
        <button onClick={signOut} className="sign-out-button">Sign Out</button>
      </header>
      
      <main>
        {verificationStep === 1 && (
          <DocumentUpload 
            onSuccess={() => setVerificationStep(2)} 
            user={user}
          />
        )}
        
        {verificationStep === 2 && (
          <LivenessCheck 
            onComplete={handleVerificationComplete} 
            user={user}
          />
        )}
        
        {verificationStep === 3 && (
          <VerificationStatus 
            data={verificationData} 
            onRestart={() => setVerificationStep(1)}
          />
        )}
      </main>
    </div>
  );
}

export default withAuthenticator(App);