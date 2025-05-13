const AWS = require('aws-sdk');
const rekognition = new AWS.Rekognition();

exports.handler = async (event) => {
  try {
    const { action, userId } = event;
    
    if (action === 'start_liveness_session') {
      // Create a new liveness session
      const sessionParams = {
        LivenessRequestToken: userId + '-' + Date.now(),
        Settings: {
          OutputConfig: {
            S3Bucket: process.env.DOCUMENT_BUCKET,
            S3KeyPrefix: `liveness/${userId}/`
          },
          AuditImagesLimit: 3
        }
      };
      
      const sessionData = await rekognition.createFaceLivenessSession(sessionParams).promise();
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          sessionId: sessionData.SessionId,
          sessionToken: sessionData.SessionToken
        })
      };
    } 
    else if (action === 'verify_liveness') {
      const { sessionId } = event;
      
      // Get liveness session results
      const resultParams = { SessionId: sessionId };
      const resultData = await rekognition.getFaceLivenessSessionResults(resultParams).promise();
      
      if (resultData.Confidence < 90) {
        throw new Error('Low confidence score');
      }
      
      // Compare face with document photo (simplified example)
      const matchResult = await compareWithDocument(userId, resultData.ReferenceImage);
      
      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          isLive: resultData.Confidence >= 90,
          confidence: resultData.Confidence,
          faceMatch: matchResult
        })
      };
    } else {
      throw new Error('Invalid action');
    }
  } catch (error) {
    console.error('Liveness check error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Liveness check failed'
      })
    };
  }
};

async function compareWithDocument(userId, referenceImage) {
  // In a real implementation, you would:
  // 1. Retrieve the document image from S3
  // 2. Use Rekognition's CompareFaces API
  // 3. Return the comparison results
  
  // Simplified implementation
  return {
    similarity: 95, // Example value
    matched: true
  };
}