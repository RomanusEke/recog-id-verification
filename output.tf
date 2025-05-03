output "amplify_app_url" {
  value = "https://main.${aws_amplify_app.identity_verification.default_domain}"
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.identity_verification_pool.id
}

output "cognito_client_id" {
  value = aws_cognito_user_pool_client.web_client.id
}

output "api_gateway_url" {
  value = "https://${aws_api_gateway_rest_api.identity_api.id}.execute-api.${var.aws_region}.amazonaws.com/prod"
}

output "document_bucket_name" {
  value = aws_s3_bucket.identity_documents.bucket
}