terraform {
  required_providers {
    aws = {
      source = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  required_version = ">= 1.0.0"
}

provider "aws" {
  region = "eu-west-1" # Change to your preferred region
}

# IAM roles and policies
resource "aws_iam_role" "rekognition_liveness_role" {
  name = "rekognition-liveness-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "rekognition.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_policy" "rekognition_liveness_policy" {
  name = "rekognition-liveness-policy"
  description = "Policy for Rekognition Liveness Detection"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "rekognition:StartFaceLivenessSession",
          "rekognition:GetFaceLivenessSessionResults"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "rekognition_liveness_attach" {
  role = aws_iam_role.rekognition_liveness_role.name
  policy_arn = aws_iam_policy.rekognition_liveness_policy.arn
}

# S3 Bucket for document storage
resource "aws_s3_bucket" "identity_documents" {
  bucket = "identity-documents-${random_id.bucket_suffix.hex}"
  force_destroy = true
}

resource "aws_s3_bucket_policy" "allow_textract_access" {
  bucket = aws_s3_bucket.identity_documents.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "textract.amazonaws.com"
        }
        Action = [
          "s3:GetObject",
          "s3:PutObject"
        ]
        Resource = "${aws_s3_bucket.identity_documents.arn}/*"
      }
    ]
  })
}

# Cognito for user authentication
resource "aws_cognito_user_pool" "identity_verification_pool" {
  name = "identity-verification-user-pool"

  username_attributes = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length = 8
    require_lowercase = true
    require_numbers = true
    require_symbols = true
    require_uppercase = true
  }

  lambda_config {
    pre_sign_up = aws_lambda_function.cognito_pre_signup.arn
  }
}

resource "aws_cognito_user_pool_client" "web_client" {
  name = "identity-verification-web-client"
  user_pool_id = aws_cognito_user_pool.identity_verification_pool.id

  generate_secret = false
  explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]
  callback_urls = ["https://${aws_amplify_app.identity_verification.default_domain}"]
  logout_urls = ["https://${aws_amplify_app.identity_verification.default_domain}"]
  allowed_oauth_flows = ["code"]
  allowed_oauth_scopes = ["email", "openid"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers = ["COGNITO"]
}

# Lambda for Cognito pre-signup validation
resource "aws_lambda_function" "cognito_pre_signup" {
  filename = "lambda_function.zip" # You need to create this zip file with your Lambda code
  function_name = "cognito-pre-signup"
  role = aws_iam_role.lambda_exec.arn
  handler = "index.handler"
  runtime = "nodejs18.x"

  environment {
    variables = {
      ALLOWED_EMAIL_DOMAINS = "example.com" # Change to your allowed domains
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name = "lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic_execution" {
  role = aws_iam_role.lambda_exec.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# API Gateway for frontend to backend communication
resource "aws_api_gateway_rest_api" "identity_api" {
  name = "identity-verification-api"
  description = "API for identity verification processes"
}

resource "aws_api_gateway_resource" "verify_resource" {
  rest_api_id = aws_api_gateway_rest_api.identity_api.id
  parent_id = aws_api_gateway_rest_api.identity_api.root_resource_id
  path_part = "verify"
}

resource "aws_api_gateway_method" "verify_post" {
  rest_api_id = aws_api_gateway_rest_api.identity_api.id
  resource_id = aws_api_gateway_resource.verify_resource.id
  http_method = "POST"
  authorization = "COGNITO_USER_POOLS"
  authorizer_id = aws_api_gateway_authorizer.cognito.id
}

resource "aws_api_gateway_integration" "lambda_integration" {
  rest_api_id = aws_api_gateway_rest_api.identity_api.id
  resource_id = aws_api_gateway_resource.verify_resource.id
  http_method = aws_api_gateway_method.verify_post.http_method
  integration_http_method = "POST"
  type = "AWS_PROXY"
  uri = aws_lambda_function.verify_identity.invoke_arn
}

resource "aws_api_gateway_authorizer" "cognito" {
  name = "cognito-authorizer"
  rest_api_id = aws_api_gateway_rest_api.identity_api.id
  type = "COGNITO_USER_POOLS"
  provider_arns = [aws_cognito_user_pool.identity_verification_pool.arn]
}

# Lambda for identity verification
resource "aws_lambda_function" "verify_identity" {
  filename = "verify_identity.zip" # You need to create this zip file with your Lambda code
  function_name = "verify-identity"
  role = aws_iam_role.lambda_exec.arn
  handler = "index.handler"
  runtime = "nodejs18.x"

  environment {
    variables = {
      REKOGNITION_ROLE_ARN = aws_iam_role.rekognition_liveness_role.arn
      DOCUMENT_BUCKET = aws_s3_bucket.identity_documents.bucket
    }
  }
}

resource "aws_lambda_permission" "apigw_lambda" {
  statement_id = "AllowExecutionFromAPIGateway"
  action = "lambda:InvokeFunction"
  function_name = aws_lambda_function.verify_identity.function_name
  principal = "apigateway.amazonaws.com"

  source_arn = "${aws_api_gateway_rest_api.identity_api.execution_arn}/*/*"
}

# Amplify for React app hosting
resource "aws_amplify_app" "identity_verification" {
  name = "identity-verification-app"
  repository = "https://github.com/your-username/identity-verification-react-app" # Change to your repo
  access_token = "your-github-access-token" # Replace with your GitHub access token

  # The default build_spec added by Amplify Console for React
  build_spec = <<-EOT
    version: 1
    frontend:
      phases:
        preBuild:
          commands:
            - npm ci
        build:
          commands:
            - npm run build
      artifacts:
        baseDirectory: build
        files:
          - '**/*'
      cache:
        paths:
          - node_modules/**/*
  EOT

  # The default rewrites and redirects added by the Amplify Console.
  custom_rule {
    source = "/<*>"
    status = "404"
    target = "/index.html"
  }

  environment_variables = {
    REACT_APP_API_URL = "https://${aws_api_gateway_rest_api.identity_api.id}.execute-api.${var.aws_region}.amazonaws.com/prod"
    REACT_APP_USER_POOL_ID = aws_cognito_user_pool.identity_verification_pool.id
    REACT_APP_CLIENT_ID = aws_cognito_user_pool_client.web_client.id
    REACT_APP_REGION = var.aws_region
    REACT_APP_S3_BUCKET = aws_s3_bucket.identity_documents.bucket
    REACT_APP_REKOGNITION_ROLE_ARN = aws_iam_role.rekognition_liveness_role.arn
  }
}

resource "aws_amplify_branch" "main" {
  app_id = aws_amplify_app.identity_verification.id
  branch_name = "main"

  framework = "React"
  stage = "PRODUCTION"
}

# Random suffix for S3 bucket
resource "random_id" "bucket_suffix" {
  byte_length = 8
}