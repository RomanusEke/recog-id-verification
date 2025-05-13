const AWS = require('aws-sdk');
const textract = new AWS.Textract();
const s3 = new AWS.S3();
const rekognition = new AWS.Rekognition();

exports.handler = async (event) => {
  try {
    const { documentKey, userId } = event;
    
    // Extract text from document using Textract
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
    
    // Detect faces in document using Rekognition (for photo ID)
    const rekognitionParams = {
      Image: {
        S3Object: {
          Bucket: process.env.DOCUMENT_BUCKET,
          Name: documentKey
        }
      },
      Attributes: ['ALL']
    };
    
    const faceData = await rekognition.detectFaces(rekognitionParams).promise();
    
    // Validate document (simplified example)
    const isValid = validateDocument(extractedText, faceData);
    
    // Store results in DynamoDB (you'll need to create this table)
    const dynamoDb = new AWS.DynamoDB.DocumentClient();
    await dynamoDb.put({
      TableName: 'IdentityVerificationResults',
      Item: {
        userId,
        documentKey,
        extractedText,
        faceCount: faceData.FaceDetails.length,
        isValid,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }).promise();
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        documentKey,
        extractedText,
        faceCount: faceData.FaceDetails.length,
        isValid
      })
    };
  } catch (error) {
    console.error('Document processing error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: 'Document processing failed'
      })
    };
  }
};

function extractTextFromBlocks(blocks) {
  return blocks
    .filter(block => block.BlockType === 'LINE')
    .map(block => block.Text)
    .join('\n');
}

function validateDocument(text, faceData) {
  // Basic validation - in a real app, you'd have more complex checks
  const requiredFields = ['name', 'date of birth', 'id number'];
  const hasAllFields = requiredFields.every(field => 
    text.toLowerCase().includes(field)
  );
  
  const hasOneFace = faceData.FaceDetails.length === 1;
  
  return hasAllFields && hasOneFace;
}