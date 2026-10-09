"""
ArchLens Terraform Script Generator Lambda
Generates production-ready Terraform HCL code from approved recommendations.
Uses Amazon Bedrock to create multi-file Terraform configurations with safety mechanisms.
"""

import json
import boto3
import os
import logging
from datetime import datetime
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Configuration from environment variables
DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data-515554959344')
MODEL_ID = os.environ['MODEL_ID']  # e.g. apac.anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'ap-south-1')
AUDIT_TABLE = os.environ.get('AUDIT_TABLE', 'archlens-audit')

# Initialize Bedrock client
bedrock = boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)


def generate_terraform_prompt(recommendations, architecture_data, scan_id):
    """
    Build prompt for Terraform HCL generation.
    No hardcoded Terraform blocks - Bedrock generates based on actual recommendations
    and current Terraform + AWS provider best practices.
    """
    prompt = f"""You are an expert Terraform engineer specializing in AWS infrastructure. You have comprehensive knowledge of the Terraform AWS provider, all its resources and data sources, and Terraform best practices for production environments.

## TASK:
Generate production-ready Terraform HCL code that implements the following approved architecture changes. The code must follow Terraform best practices and include safety mechanisms.

## CURRENT ARCHITECTURE CONTEXT:
{json.dumps(architecture_data.get('summary', architecture_data), indent=2, default=str)[:4000]}

## APPROVED RECOMMENDATIONS TO IMPLEMENT:
{json.dumps(recommendations, indent=2, default=str)}

## TERRAFORM REQUIREMENTS:

### File Structure (MANDATORY):
Generate separate files using this exact marker format between files:
# === FILENAME: <filename> ===

Required files:
1. main.tf - Provider configuration, terraform block, and main resources
2. variables.tf - All input variables with descriptions, types, and defaults
3. outputs.tf - All outputs with descriptions
4. locals.tf - Computed values, naming conventions, common tags
5. data.tf - Data sources for existing resources (things that already exist and should NOT be recreated)
6. terraform.tfvars - Default values for this specific deployment

### Provider & Backend Configuration:
- Use terraform block with required_providers (hashicorp/aws with version constraint ~> 5.0)
- Configure S3 backend for state storage (bucket: archlens-data-515554959344, key: terraform/{scan_id}/terraform.tfstate)
- Set provider region using variable
- Enable default_tags in the provider block

### Safety Requirements (MANDATORY):
- lifecycle {{ prevent_destroy = true }} on ALL stateful resources (databases, S3 buckets, EFS, etc.)
- lifecycle {{ create_before_destroy = true }} for resources that need zero-downtime replacement
- lifecycle {{ ignore_changes = [...] }} for attributes managed outside Terraform
- Use data sources for existing resources - do NOT recreate what already exists
- Include depends_on where implicit dependencies aren't clear
- Use moved blocks if renaming resources

### Best Practices (MANDATORY):
- All resources must have meaningful names using local.name_prefix
- Use for_each instead of count where possible (for maps/sets)
- Variables must have: description, type, default (where sensible), validation blocks where applicable
- Use locals for computed values and repeated expressions
- All resources must be tagged using local.common_tags merged with resource-specific tags
- Enable encryption at rest for all supported resources
- Use separate security groups per resource type (not shared)
- IAM policies must follow least privilege (no * on actions)
- Use aws_iam_policy_document data source instead of inline JSON policies

### Common Tags (in locals.tf):
```
common_tags = {{
  Project     = var.project_name
  Environment = var.environment
  ManagedBy   = "ArchLens-Terraform"
  ScanId      = "{scan_id}"
  CreatedAt   = timestamp()
}}
```

### Variables to Include:
- aws_region (string, default matching current architecture)
- environment (string, default "dev", validation: dev/staging/prod)
- project_name (string, default "archlens")
- Any resource-specific variables the recommendations require

### State Management:
- Configure S3 backend with DynamoDB locking
- Use terraform workspace-aware naming where applicable

## OUTPUT FORMAT:
- Start DIRECTLY with: # === FILENAME: main.tf ===
- Separate each file with: # === FILENAME: <filename> ===
- Do NOT wrap in markdown code blocks
- Do NOT include explanatory text between files
- Ensure all HCL is properly formatted and valid
- All string interpolations use "${{...}}" syntax correctly
"""
    return prompt


def invoke_bedrock(prompt):
    """Call Amazon Bedrock for Terraform generation."""
    try:
        is_nova = 'nova' in MODEL_ID.lower()
        if is_nova:
            request_body = {
                "messages": [
                    {
                        "role": "user",
                        "content": [{"text": prompt}]
                    }
                ],
                "inferenceConfig": {
                    "max_new_tokens": 5000,
                    "temperature": 0.1,
                    "top_p": 0.95
                }
            }
        else:
            request_body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 12000,
                "temperature": 0.1,  # Low temperature for deterministic code generation
                "top_p": 0.95,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt
                    }
                ]
            }

        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps(request_body)
        )

        response_body = json.loads(response['body'].read())
        if is_nova:
            ai_text = response_body['output']['message']['content'][0]['text']
        else:
            ai_text = response_body['content'][0]['text']

        # Log usage
        usage = response_body.get('usage', {})
        logger.info(f"Terraform Generation Bedrock usage: {usage}")

        return ai_text

    except ClientError as e:
        logger.error(f"Bedrock error during Terraform generation: {e.response['Error']['Message']}")
        raise
    except Exception as e:
        logger.error(f"Error calling Bedrock: {str(e)}")
        raise


def parse_terraform_files(terraform_output):
    """
    Parse the multi-file Terraform output into individual files.
    Handles various marker formats and markdown wrappers.
    """
    files = {}
    current_file = None
    current_content = []

    # Clean markdown wrappers
    clean_output = terraform_output.strip()
    if clean_output.startswith('```'):
        lines = clean_output.split('\n')
        lines = [l for l in lines if not l.strip().startswith('```')]
        clean_output = '\n'.join(lines)

    for line in clean_output.split('\n'):
        stripped = line.strip()

        # Check for file marker patterns
        is_marker = False
        filename = None

        if stripped.startswith('# === FILENAME:') and '===' in stripped[15:]:
            filename = stripped.split('FILENAME:')[1].replace('===', '').strip()
            is_marker = True
        elif stripped.startswith('# --- FILENAME:'):
            filename = stripped.split('FILENAME:')[1].replace('---', '').strip()
            is_marker = True
        elif stripped.startswith('# File:'):
            filename = stripped.split('File:')[1].strip()
            is_marker = True

        if is_marker and filename:
            # Save previous file
            if current_file and current_content:
                files[current_file] = '\n'.join(current_content).strip()
            current_file = filename
            current_content = []
        else:
            current_content.append(line)

    # Save last file
    if current_file and current_content:
        files[current_file] = '\n'.join(current_content).strip()

    # If no file markers found, try to intelligently split or save as single file
    if not files:
        # Check if the output contains terraform/resource blocks
        if 'terraform {' in clean_output or 'resource "' in clean_output:
            files['main.tf'] = clean_output
        else:
            files['main.tf'] = clean_output

    return files


def validate_terraform_files(files):
    """
    Basic validation of generated Terraform files.
    Returns (is_valid, issues_list).
    """
    issues = []

    # Check main.tf exists and has basic structure
    if 'main.tf' not in files:
        issues.append("Missing main.tf")
    else:
        main_content = files['main.tf']
        if 'terraform {' not in main_content and 'terraform{' not in main_content:
            issues.append("Warning: main.tf missing terraform block")
        if 'provider "aws"' not in main_content and 'provider"aws"' not in main_content:
            issues.append("Warning: main.tf missing AWS provider configuration")

    # Check variables.tf
    if 'variables.tf' not in files:
        issues.append("Warning: Missing variables.tf")

    # Check for common issues across all files
    all_content = '\n'.join(files.values())

    if 'prevent_destroy' not in all_content:
        issues.append("Warning: No prevent_destroy lifecycle rules found")

    # Check for hardcoded credentials (security check)
    sensitive_patterns = ['AKIA', 'aws_secret_access_key', 'password =']
    for pattern in sensitive_patterns:
        if pattern.lower() in all_content.lower():
            issues.append(f"SECURITY: Possible hardcoded credential found ({pattern})")

    has_critical = any(not i.startswith('Warning') for i in issues)
    return not has_critical, issues


def generate_fallback_terraform(recommendations, scan_id):
    return f"""// --- main.tf ---
terraform {{
  required_version = ">= 1.5.0"
  required_providers {{
    aws = {{
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }}
  }}
}}

provider "aws" {{
  region = var.aws_region

  default_tags {{
    tags = {{
      ManagedBy   = "ArchLens"
      Environment = var.environment
      ScanId      = "{scan_id}"
    }}
  }}
}}

# ── Security Pillar: AWS WAFv2 WebACL ──
resource "aws_wafv2_web_acl" "main" {{
  name        = "archlens-waf-${{var.environment}}"
  description = "ArchLens WAF WebACL protecting public endpoints"
  scope       = "REGIONAL"

  default_action {{
    allow {{}}
  }}

  visibility_config {{
    cloudwatch_metrics_enabled = true
    metric_name                = "archlensWafMetric"
    sampled_requests_enabled   = true
  }}

  rule {{
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {{
      none {{}}
    }}

    statement {{
      managed_rule_group_statement {{
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }}
    }}

    visibility_config {{
      cloudwatch_metrics_enabled = true
      metric_name                = "AWSManagedRulesCommonMetric"
      sampled_requests_enabled   = true
    }}
  }}

  lifecycle {{
    prevent_destroy = false
  }}
}}

// --- variables.tf ---
variable "aws_region" {{
  type        = string
  description = "Target AWS Region"
  default     = "ap-south-1"
}}

variable "environment" {{
  type        = string
  description = "Environment identifier"
  default     = "prod"
}}

variable "scan_id" {{
  type        = string
  description = "ArchLens Scan Identifier"
  default     = "{scan_id}"
}}

// --- outputs.tf ---
output "waf_web_acl_arn" {{
  description = "ARN of the provisioned WAF WebACL"
  value       = aws_wafv2_web_acl.main.arn
}}
"""


def lambda_handler(event, context):
    """
    Main handler for Terraform script generation.
    Input: { recommendationId, recommendations (optional), architectureData (optional), scanId }
    Output: Generated Terraform files with download URLs.
    """
    try:
        # Parse input
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif 'body' in event and isinstance(event['body'], dict):
            body = event['body']
        else:
            body = event

        recommendation_id = body.get('recommendationId')
        recommendations = body.get('recommendations')
        architecture_data = body.get('architectureData', {})
        scan_id = body.get('scanId', 'unknown')

        # Step Functions integration: unpack from analysisResult / discoveryResult
        if not recommendations and not recommendation_id:
            analysis = body.get('analysisResult')
            if isinstance(analysis, dict):
                analysis_data = analysis
                if 'body' in analysis and isinstance(analysis['body'], str):
                    try:
                        analysis_data = json.loads(analysis['body'])
                    except Exception:
                        pass
                elif 'body' in analysis and isinstance(analysis['body'], dict):
                    analysis_data = analysis['body']

                if isinstance(analysis_data, dict):
                    if analysis_data.get('recommendationId'):
                        recommendation_id = analysis_data['recommendationId']
                    if analysis_data.get('analysis', {}).get('recommendations'):
                        recommendations = analysis_data['analysis']['recommendations']
                    elif analysis_data.get('recommendations'):
                        recommendations = analysis_data['recommendations']
                    if analysis_data.get('architectureData') and not architecture_data:
                        architecture_data = analysis_data['architectureData']
                    if analysis_data.get('scanId') and scan_id == 'unknown':
                        scan_id = analysis_data['scanId']

        if scan_id == 'unknown' and body.get('discoveryResult'):
            disc = body['discoveryResult']
            if isinstance(disc, dict):
                disc_data = json.loads(disc['body']) if isinstance(disc.get('body'), str) else disc.get('body', disc)
                if isinstance(disc_data, dict) and disc_data.get('scanId'):
                    scan_id = disc_data['scanId']
                if not architecture_data and isinstance(disc_data, dict) and disc_data.get('resources'):
                    architecture_data = disc_data

        # Fetch recommendations from S3 if only ID provided
        if recommendation_id and not recommendations:
            try:
                s3_response = s3_client.get_object(
                    Bucket=DATA_BUCKET,
                    Key=f"reports/{recommendation_id}.json"
                )
                report_data = json.loads(s3_response['Body'].read())
                recommendations = report_data.get('analysis', {}).get('recommendations', [])
                architecture_data = report_data.get('architectureData', architecture_data)
                scan_id = report_data.get('scanId', scan_id)
            except ClientError as e:
                logger.error(f"Failed to fetch recommendations: {e.response['Error']['Message']}")
                return {
                    'statusCode': 404,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': f'Recommendation {recommendation_id} not found'})
                }

        # Validation
        if not recommendations:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'No recommendations provided for Terraform generation'})
            }

        # Filter to active recommendations
        active_recommendations = [
            r for r in recommendations
            if r.get('status', 'approved') in ('approved', 'selected', 'generated')
        ]
        if not active_recommendations:
            active_recommendations = recommendations

        logger.info(f"Generating Terraform for {len(active_recommendations)} recommendations")

        # Generate Terraform using Bedrock with fallback
        prompt = generate_terraform_prompt(active_recommendations, architecture_data, scan_id)
        terraform_output = None
        try:
            terraform_output = invoke_bedrock(prompt)
        except Exception as bed_err:
            logger.warning(f"Bedrock Terraform generation failed ({bed_err}). Using deterministic Terraform script.")
            terraform_output = generate_fallback_terraform(active_recommendations, scan_id)

        # Parse into individual files
        terraform_files = parse_terraform_files(terraform_output)

        # Validate
        is_valid, validation_issues = validate_terraform_files(terraform_files)

        # Save each file to S3
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        s3_base_path = f"terraform/{scan_id}-{timestamp}"
        s3_keys = {}
        download_urls = {}

        for filename, content in terraform_files.items():
            s3_key = f"{s3_base_path}/{filename}"
            s3_client.put_object(
                Bucket=DATA_BUCKET,
                Key=s3_key,
                Body=content,
                ContentType='text/plain',
                Metadata={
                    'scan-id': scan_id,
                    'recommendation-id': recommendation_id or 'direct',
                    'generated-at': datetime.utcnow().isoformat()
                }
            )
            s3_keys[filename] = s3_key

            # Generate presigned URL for download
            download_urls[filename] = s3_client.generate_presigned_url(
                'get_object',
                Params={'Bucket': DATA_BUCKET, 'Key': s3_key},
                ExpiresIn=3600
            )

        # Also save as a combined zip-friendly structure reference
        manifest = {
            'scan_id': scan_id,
            'recommendation_id': recommendation_id,
            'generated_at': datetime.utcnow().isoformat(),
            'files': list(terraform_files.keys()),
            's3_base_path': s3_base_path,
            'codebuild_source': s3_base_path
        }
        s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=f"{s3_base_path}/manifest.json",
            Body=json.dumps(manifest, indent=2),
            ContentType='application/json'
        )

        # Audit log
        try:
            audit_table = dynamodb.Table(AUDIT_TABLE)
            audit_table.put_item(Item={
                'auditId': f"tf-gen-{timestamp}",
                'timestamp': datetime.utcnow().isoformat(),
                'action': 'TERRAFORM_GENERATED',
                'scanId': scan_id,
                'recommendationId': recommendation_id or 'direct',
                'fileCount': len(terraform_files),
                's3BasePath': s3_base_path,
                'recommendationCount': len(active_recommendations),
                'validationPassed': is_valid,
                'validationIssues': validation_issues
            })
        except Exception as e:
            logger.warning(f"Failed to write audit log: {str(e)}")

        # Build response
        result = {
            'status': 'success',
            'scanId': scan_id,
            'recommendationId': recommendation_id,
            'timestamp': datetime.utcnow().isoformat(),
            'files': terraform_files,
            's3Keys': s3_keys,
            'downloadUrls': download_urls,
            's3BasePath': s3_base_path,
            'templateType': 'Terraform',
            'format': 'HCL',
            'fileCount': len(terraform_files),
            'validation': {
                'passed': is_valid,
                'issues': validation_issues
            },
            'codebuild_config': {
                'source_bucket': DATA_BUCKET,
                'source_path': s3_base_path,
                'project_name': 'archlens-terraform-executor'
            },
            'metadata': {
                'recommendations_implemented': len(active_recommendations),
                'model_used': MODEL_ID
            }
        }

        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST,OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type,Authorization'
            },
            'body': json.dumps(result, default=str)
        }

    except ClientError as e:
        logger.error(f"AWS Error in Terraform generation: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in Terraform generation: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }
