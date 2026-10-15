"""
ArchLens CloudFormation Template Generator Lambda
Generates production-ready CloudFormation templates from approved recommendations.
Uses Amazon Bedrock to create templates with safety mechanisms built in.
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
DATA_BUCKET = os.environ.get('DATA_BUCKET', 'archlens-data')
MODEL_ID = os.environ.get('MODEL_ID', 'apac.anthropic.claude-3-5-sonnet-20241022-v2:0')
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'ap-south-1')
MAX_TOKENS = int(os.environ['MAX_TOKENS'])
AUDIT_TABLE = os.environ.get('AUDIT_TABLE', 'archlens-audit')

# Initialize Bedrock client
bedrock = boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)


def generate_cft_prompt(recommendations, architecture_data, scan_id):
    """
    Build prompt for CloudFormation template generation.
    No hardcoded templates - Bedrock generates based on actual recommendations
    and current AWS CloudFormation best practices.
    """
    prompt = f"""You are an expert AWS CloudFormation engineer with deep knowledge of all AWS services, CloudFormation best practices, and infrastructure safety patterns.

## TASK:
Generate a production-ready AWS CloudFormation YAML template that implements the following approved architecture changes. The template must be safe to deploy with built-in protection mechanisms.

## CURRENT ARCHITECTURE CONTEXT:
{json.dumps(architecture_data.get('summary', architecture_data), indent=2, default=str)[:4000]}

## APPROVED RECOMMENDATIONS TO IMPLEMENT:
{json.dumps(recommendations, indent=2, default=str)}

## CLOUDFORMATION REQUIREMENTS:

### Structure:
- AWSTemplateFormatVersion: '2010-09-09'
- Description that includes scan reference: {scan_id}
- Parameters for all configurable values (region, environment, naming)
- Conditions for optional features
- Resources with proper ordering
- Outputs for all important endpoints, ARNs, and IDs

### Safety Requirements (MANDATORY):
- DeletionPolicy: Retain on ALL stateful resources (databases, S3, EFS, etc.)
- DeletionPolicy: Snapshot on all resources that support snapshots (RDS, EBS)
- UpdateReplacePolicy: Snapshot where applicable
- Use DependsOn for explicit resource ordering where implicit dependencies aren't clear
- Never use hardcoded account IDs - use AWS::AccountId pseudo parameter
- Never use hardcoded regions - use AWS::Region pseudo parameter
- Use Fn::Sub for string interpolation instead of Fn::Join where possible

### Best Practices (MANDATORY):
- Use the latest resource type specifications
- Include proper IAM policies with least privilege (no wildcards on actions)
- Add meaningful Tags on all taggable resources:
    - Project: ArchLens
    - Environment: !Ref Environment
    - ManagedBy: ArchLens-AutoRemediate
    - ScanId: {scan_id}
    - CreatedAt: !Ref AWS::StackName
- Enable encryption at rest for all supported resources
- Enable logging where applicable
- Use VPC endpoints instead of public endpoints where possible
- Include CloudWatch alarms for critical metrics
- Use Mappings for region-specific or environment-specific values if needed

### Parameters to Include:
- Environment (dev/staging/prod with default 'dev')
- ProjectName (default 'ArchLens')
- Any resource-specific parameters the recommendations require
- NotificationEmail (for SNS alerts)

### Template Validation:
- All !Ref and !GetAtt references must be valid
- Resource logical IDs must be PascalCase with no special characters
- Parameter names must be descriptive and PascalCase
- Include AllowedValues constraints where applicable
- Include MinLength/MaxLength constraints for string parameters

## OUTPUT FORMAT:
Provide ONLY the CloudFormation template in valid YAML format.
- Start directly with "AWSTemplateFormatVersion"
- Do NOT wrap in markdown code blocks
- Do NOT include any text before or after the template
- Ensure the YAML is properly indented and valid
"""
    return prompt


def invoke_bedrock(prompt):
    """Call Amazon Bedrock for CFT generation with appropriate settings."""
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
                    "max_new_tokens": MAX_TOKENS,
                    "temperature": 0.1
                }
            }
        else:
            request_body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": MAX_TOKENS,
                "temperature": 0.1,  # Low temperature for deterministic code generation
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
        logger.info(f"CFT Generation Bedrock usage: {usage}")

        return ai_text

    except ClientError as e:
        logger.error(f"Bedrock error during CFT generation: {e.response['Error']['Message']}")
        raise
    except Exception as e:
        logger.error(f"Error calling Bedrock: {str(e)}")
        raise


def clean_template(raw_template):
    """
    Clean the generated template - remove markdown wrappers and validate basic structure.
    """
    template = raw_template.strip()

    # Remove markdown code block wrappers if present
    if template.startswith('```'):
        lines = template.split('\n')
        # Remove first line (```yaml or ```)
        if lines[0].strip().startswith('```'):
            lines = lines[1:]
        # Remove last line (```)
        if lines and lines[-1].strip() == '```':
            lines = lines[:-1]
        template = '\n'.join(lines)

    # Basic validation - check if it starts with AWSTemplateFormatVersion
    if not template.strip().startswith('AWSTemplateFormatVersion'):
        # Try to find it in the text
        idx = template.find('AWSTemplateFormatVersion')
        if idx >= 0:
            template = template[idx:]
        else:
            logger.warning("Generated template does not start with AWSTemplateFormatVersion")

    return template.strip()


def validate_template_structure(template):
    """
    Basic structural validation of the CloudFormation template.
    Returns (is_valid, issues_list).
    """
    issues = []

    if 'AWSTemplateFormatVersion' not in template:
        issues.append("Missing AWSTemplateFormatVersion")

    if 'Resources:' not in template and 'Resources :' not in template:
        issues.append("Missing Resources section")

    if 'DeletionPolicy' not in template:
        issues.append("Warning: No DeletionPolicy found - stateful resources may not be protected")

    # Check for common security issues
    if '* ' in template and 'Action:' in template:
        # This is a rough check - could be in resource ARNs which is OK
        action_lines = [l for l in template.split('\n') if 'Action:' in l and '*' in l]
        if action_lines:
            issues.append("Warning: Wildcard (*) found in IAM actions - review for least privilege")

    return len([i for i in issues if not i.startswith('Warning')]) == 0, issues


def lambda_handler(event, context):
    """
    Main handler for CloudFormation template generation.
    Input: { recommendationId, recommendations (optional), architectureData (optional), scanId }
    Output: Generated CFT with download URL.
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
                'body': json.dumps({'error': 'No recommendations provided for CFT generation'})
            }

        # Filter to only approved/selected recommendations if status field exists
        active_recommendations = [
            r for r in recommendations
            if r.get('status', 'approved') in ('approved', 'selected', 'generated')
        ]
        if not active_recommendations:
            active_recommendations = recommendations

        logger.info(f"Generating CFT for {len(active_recommendations)} recommendations")

        # Generate CloudFormation template (NO FALLBACKS)
        prompt = generate_cft_prompt(active_recommendations, architecture_data, scan_id)
        raw_template = None
        try:
            raw_template = invoke_bedrock(prompt)
        except Exception as bed_err:
            logger.error(f"Bedrock CFT generation failed: {str(bed_err)}")
            return {
                'statusCode': 502,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': f"Bedrock CFT Generation Failed: {str(bed_err)}"})
            }

        # Clean and validate
        cft_template = clean_template(raw_template)
        is_valid, validation_issues = validate_template_structure(cft_template)
        if not is_valid or not cft_template.strip():
            logger.error(f"Bedrock generated invalid CloudFormation template: {validation_issues}")
            return {
                'statusCode': 502,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({
                    'error': f"Bedrock generated invalid CloudFormation template: {'; '.join(validation_issues) if validation_issues else 'Empty template'}"
                })
            }

        # Generate unique filename
        timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
        cft_key = f"cloudformation/archlens-{scan_id}-{timestamp}.yaml"

        # Save to S3
        s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=cft_key,
            Body=cft_template,
            ContentType='application/x-yaml',
            Metadata={
                'scan-id': scan_id,
                'recommendation-id': recommendation_id or 'direct',
                'generated-at': datetime.utcnow().isoformat(),
                'recommendation-count': str(len(active_recommendations))
            }
        )

        # Generate presigned URL for download (valid for 1 hour)
        download_url = s3_client.generate_presigned_url(
            'get_object',
            Params={'Bucket': DATA_BUCKET, 'Key': cft_key},
            ExpiresIn=3600
        )

        # Audit log
        try:
            audit_table = dynamodb.Table(AUDIT_TABLE)
            audit_table.put_item(Item={
                'auditId': f"cft-gen-{timestamp}",
                'timestamp': datetime.utcnow().isoformat(),
                'action': 'CFT_GENERATED',
                'scanId': scan_id,
                'recommendationId': recommendation_id or 'direct',
                'templateKey': cft_key,
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
            'template': cft_template,
            's3Key': cft_key,
            'downloadUrl': download_url,
            'templateType': 'CloudFormation',
            'format': 'YAML',
            'validation': {
                'passed': is_valid,
                'issues': validation_issues
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
        logger.error(f"AWS Error in CFT generation: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in CFT generation: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }
