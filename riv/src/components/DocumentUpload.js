import React, { useState } from 'react';
import { Storage } from 'aws-amplify';
import { v4 as uuidv4 } from 'uuid';
import './DocumentUpload.css';

const DocumentUpload = ({ onSuccess, user }) => {
  const [file, setFile] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const fileId = uuidv4();
      const fileName = `users/${user.username}/documents/${fileId}-${file.name}`;
      
      await Storage.put(fileName, file, {
        contentType: file.type,
        metadata: {
          userId: user.username,
          documentType: 'identity'
        }
      });

      // Trigger document processing
      await processDocument(fileName);
      
      onSuccess();
    } catch (err) {
      console.error('Upload failed:', err);
      setError('Document upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const processDocument = async (fileName) => {
    try {
      const response = await fetch(process.env.REACT_APP_API_URL + '/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await Auth.currentSession()).getIdToken().getJwtToken()}`
        },
        body: JSON.stringify({
          action: 'process_document',
          documentKey: fileName
        })
      });
      
      if (!response.ok) {
        throw new Error('Document processing failed');
      }
      
      return await response.json();
    } catch (err) {
      console.error('Document processing error:', err);
      throw err;
    }
  };

  return (
    <div className="document-upload">
      <h2>Step 1: Upload Identity Document</h2>
      <p>Please upload a clear photo of your government-issued ID (passport, driver's license, etc.)</p>
      
      <form onSubmit={handleSubmit}>
        <div className="file-input-container">
          <input 
            type="file" 
            id="document-upload"
            accept="image/*,.pdf"
            onChange={handleFileChange}
            required
          />
          <label htmlFor="document-upload" className="file-input-label">
            {file ? file.name : 'Choose File'}
          </label>
        </div>
        
        {file && (
          <div className="file-preview">
            {file.type.startsWith('image/') ? (
              <img src={URL.createObjectURL(file)} alt="Document preview" />
            ) : (
              <div className="file-icon">
                <span>{file.name.split('.').pop().toUpperCase()}</span>
              </div>
            )}
          </div>
        )}
        
        <button 
          type="submit" 
          disabled={!file || isUploading}
          className="upload-button"
        >
          {isUploading ? 'Uploading...' : 'Upload & Verify'}
        </button>
        
        {error && <p className="error-message">{error}</p>}
      </form>
    </div>
  );
};

export default DocumentUpload;