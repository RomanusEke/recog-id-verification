const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();
const rekognition = new AWS.Rekognition();
const textract = new AWS.Textract();
const s3 = new AWS.S3();

exports.handler = async (event) => {
  try {
    console.log('Incoming event:', JSON.stringify(event, null, 2));
   
    const { action, userId } = event;
   
    // Route based on action type
    switch (action) {
      case 'process_document':
        return await processDocument(event);
      case 'start_liveness_session':
        return await startLivenessSession(event);
      case 'verify_liveness':
        return await verifyLiveness(event);
      case 'compare_faces':
        return await compareFaces(event);
      default:
        throw new Error(`Invalid action: ${action}`);
    }
  } catch (error) {
    console.error('Verification error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message || 'Verification failed'
      })
    };
  }
};

// Process uploaded identity document
async function processDocument(event) {
  const { documentKey, userId } = event;
 
  // 1. Extract text from document using Textract
  const textractParams = {
    Document: {
      S3Object: {
        Bucket: process.env.DOCUMENT_BUCKET,
        Name: documentKey
      }
    },
    FeatureTypes: ['FORMS']
  };
 
  const textractData = await textract.analyzeDocument(textractParams).promise();
  const extractedText = extractTextFromBlocks(textractData.Blocks);
 
  // 2. Detect faces in document
  const faceParams = {
    Image: {
      S3Object: {
        Bucket: process.env.DOCUMENT_BUCKET,
        Name: documentKey
      }
    },
    Attributes: ['ALL']
  };
 
  const faceData = await rekognition.detectFaces(faceParams).promise();
 
  // 3. Validate document meets requirements
  const validationResult = validateDocument(extractedText, faceData);
 
  // 4. Store document and face data
  await storeVerificationData(userId, {
    documentKey,
    extractedText,
    faceDetails: faceData.FaceDetails,
    documentValid: validationResult.isValid,
    validationErrors: validationResult.errors,
    documentType: detectDocumentType(extractedText)
  });
 
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      documentKey,
      isValid: validationResult.isValid,
      documentType: detectDocumentType(extractedText),
      fields: extractKeyFields(extractedText)
    })
  };
}

// Start face liveness session
async function startLivenessSession(event) {
  const { userId } = event;
 
  const sessionParams = {
    LivenessRequestToken: `${userId}-${Date.now()}`,
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

// Verify liveness session results
async function verifyLiveness(event) {
  const { sessionId, userId } = event;
 
  // 1. Get liveness results
  const resultParams = { SessionId: sessionId };
  const resultData = await rekognition.getFaceLivenessSessionResults(resultParams).promise();
 
  // 2. Check confidence score
  if (resultData.Confidence < process.env.MIN_LIVENESS_CONFIDENCE || 90) {
    throw new Error('Liveness check failed - confidence too low');
  }
 
  // 3. Get reference image from S3
  const referenceImage = await getReferenceImage(resultData.ReferenceImage);
 
  // 4. Compare with document photo
  const comparisonResult = await compareWithDocument(userId, referenceImage);
 
  // 5. Update verification status
  await updateVerificationStatus(userId, {
    livenessCheckPassed: true,
    livenessConfidence: resultData.Confidence,
    faceMatch: comparisonResult.matched,
    faceSimilarity: comparisonResult.similarity,
    verificationCompleted: true
  });
 
  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      isLive: true,
      confidence: resultData.Confidence,
      faceMatch: comparisonResult.matched,
      similarity: comparisonResult.similarity
    })
  };
}

// Compare faces between liveness and document
async function compareFaces(event) {
  const { userId, sourceImageKey } = event;
 
  // 1. Get document face from previous verification data
  const verificationData = await getVerificationData(userId);
 
  if (!verificationData?.documentKey) {
    throw new Error('No document found for comparison');
  }
 
  // 2. Compare faces
  const compareParams = {
    SourceImage: {
      S3Object: {
        Bucket: process.env.DOCUMENT_BUCKET,
        Name: verificationData.documentKey
      }
    },
    TargetImage: {
      S3Object: {
        Bucket: process.env.DOCUMENT_BUCKET,
        Name: sourceImageKey
      }
    },
    SimilarityThreshold: 80
  };
 
  const comparison = await rekognition.compareFaces(compareParams).promise();
 
  if (!comparison.FaceMatches || comparison.FaceMatches.length === 0) {
    return {
      matched: false,
      similarity: 0
    };
  }
 
  return {
    matched: true,
    similarity: comparison.FaceMatches[0].Similarity
  };
}

// Helper Functions

function extractTextFromBlocks(blocks) {
  return blocks
    .filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n');
}

function validateDocument(text, faceData) {
  const errors = [];
  const requiredFields = ['name', 'date of birth', 'id number'];
 
  // Check required text fields
  requiredFields.forEach(field => {
    if (!text.toLowerCase().includes(field)) {
      errors.push(`Missing field: ${field}`);
    }
  });
 
  // Check face requirements
  if (faceData.FaceDetails.length !== 1) {
    errors.push(`Document must contain exactly one face (found ${faceData.FaceDetails.length})`);
  } else {
    const face = faceData.FaceDetails[0];
   
    if (face.Quality.Brightness < 50 || face.Quality.Brightness > 150) {
      errors.push('Face brightness out of range');
    }
   
    if (face.Quality.Sharpness < 50) {
      errors.push('Face image not sharp enough');
    }
  }
 
  return {
    isValid: errors.length === 0,
    errors
  };
}

function detectDocumentType(text) {
  if (text.match(/passport|passeport|pasaporte/i)) return 'PASSPORT';
  if (text.match(/driver|license|permis|conduire/i)) return 'DRIVER_LICENSE';
  if (text.match(/national|id card|identity|identité/i)) return 'NATIONAL_ID';
  return 'UNKNOWN';
}

function extractKeyFields(text) {
  const fields = {};
 
  // Simple example - in production you'd use more sophisticated parsing
  const nameMatch = text.match(/name[\s:]*([^\n]+)/i);
  if (nameMatch) fields.fullName = nameMatch[1].trim();
 
  const dobMatch = text.match(/date of birth[\s:]*([^\n]+)/i);
  if (dobMatch) fields.dateOfBirth = dobMatch[1].trim();
 
  const idMatch = text.match(/(id|number|no)[\s:]*([^\n]+)/i);
  if (idMatch) fields.documentNumber = idMatch[2].trim();
 
  return fields;
}

async function storeVerificationData(userId, data) {
  const params = {
    TableName: process.env.VERIFICATION_TABLE,
    Item: {
      userId,
      ...data,
      timestamp: new Date().toISOString()
    }
  };
 
  await dynamodb.put(params).promise();
}

async function updateVerificationStatus(userId, updates) {
  const params = {
    TableName: process.env.VERIFICATION_TABLE,
    Key: { userId },
    UpdateExpression: 'SET ' + Object.keys(updates).map(k => `${k} = :${k}`).join(', '),
    ExpressionAttributeValues: Object.fromEntries(
      Object.entries(updates).map(([k, v]) => [`:${k}`, v])
    ),
    ReturnValues: 'UPDATED_NEW'
  };
 
  await dynamodb.update(params).promise();
}

async function getVerificationData(userId) {
  const params = {
    TableName: process.env.VERIFICATION_TABLE,
    Key: { userId }
  };
 
  const result = await dynamodb.get(params).promise();
  return result.Item;
}

async function getReferenceImage(referenceImage) {
  const params = {
    Bucket: referenceImage.S3Object.Bucket,
    Key: referenceImage.S3Object.Name
  };
 
  return await s3.getObject(params).promise();
}

async function compareWithDocument(userId, referenceImage) {
  // 1. Get document from verification data
  const verificationData = await getVerificationData(userId);
 
  if (!verificationData?.documentKey) {
    throw new Error('No document found for comparison');
  }
 
  // 2. Compare faces
  const compareParams = {
    SourceImage: {
      S3Object: {
        Bucket: process.env.DOCUMENT_BUCKET,
        Name: verificationData.documentKey
      }
    },
    TargetImage: {
      Bytes: referenceImage.Body
    },
    SimilarityThreshold: 80
  };
 
  const comparison = await rekognition.compareFaces(compareParams).promise();
 
  if (!comparison.FaceMatches || comparison.FaceMatches.length === 0) {
    return {
      matched: false,
      similarity: 0
    };
  }
 
  return {
    matched: true,
    similarity: comparison.FaceMatches[0].Similarity
  };
}