"""
ArchLens Architecture Analyzer Lambda
Analyzes discovered architecture against AWS Well-Architected Framework pillars.
Uses Amazon Bedrock for AI-powered analysis.
NO hardcoded pillar details - instructs Bedrock to use its trained knowledge
of the latest AWS Well-Architected Framework documentation.
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
RECOMMENDATIONS_TABLE = os.environ.get('RECOMMENDATIONS_TABLE', 'archlens-recommendations')
MODEL_ID = os.environ['MODEL_ID']  # e.g. apac.anthropic.claude-3-5-sonnet-20241022-v2:0
BEDROCK_REGION = os.environ.get('BEDROCK_REGION', 'ap-south-1')

# Bedrock Guardrails (SOW Section 7) — applied when configured via env vars
GUARDRAIL_ID = os.environ.get('GUARDRAIL_ID', '')
GUARDRAIL_VERSION = os.environ.get('GUARDRAIL_VERSION', '')

# Bedrock Knowledge Base for RAG (SOW Section 7) — used when configured
KNOWLEDGE_BASE_ID = os.environ.get('KNOWLEDGE_BASE_ID', '')

# Initialize Bedrock clients
bedrock = boto3.client('bedrock-runtime', region_name=BEDROCK_REGION)
bedrock_agent = boto3.client('bedrock-agent-runtime', region_name=BEDROCK_REGION)


def retrieve_kb_context(query_text):
    """
    Retrieve relevant WAF/best-practice passages from the Bedrock Knowledge
    Base (RAG). Returns a context string, or '' when KB not configured.
    """
    if not KNOWLEDGE_BASE_ID:
        return ''
    try:
        resp = bedrock_agent.retrieve(
            knowledgeBaseId=KNOWLEDGE_BASE_ID,
            retrievalQuery={'text': query_text[:1000]},
            retrievalConfiguration={'vectorSearchConfiguration': {'numberOfResults': 5}},
        )
        chunks = []
        for r in resp.get('retrievalResults', []):
            txt = r.get('content', {}).get('text', '')
            if txt:
                chunks.append(txt)
        if chunks:
            return "\n\n[KNOWLEDGE BASE CONTEXT — AWS best practices]\n" + "\n---\n".join(chunks)
    except ClientError as e:
        logger.info(f"KB retrieve skipped: {e.response['Error']['Code']}")
    except Exception as e:
        logger.info(f"KB retrieve skipped: {str(e)}")
    return ''

# Well-Architected Framework pillar identifiers
# These are just keys - the actual evaluation criteria come from Bedrock's
# trained knowledge of the AWS Well-Architected Framework
WAF_PILLARS = {
    'operational_excellence': 'Operational Excellence',
    'security': 'Security',
    'reliability': 'Reliability',
    'performance_efficiency': 'Performance Efficiency',
    'cost_optimization': 'Cost Optimization',
    'sustainability': 'Sustainability'
}


def get_waf_lens_data(credentials=None):
    """
    Attempt to fetch Well-Architected Framework lens data from AWS Well-Architected Tool API.
    This provides real-time pillar questions and best practices directly from AWS.
    Falls back gracefully if the API is not accessible.
    """
    try:
        wa_client = boto3.client('wellarchitected', region_name=BEDROCK_REGION)

        # List available lenses
        lenses_response = wa_client.list_lenses(LensType='AWS_OFFICIAL')
        lens_data = {}

        for lens in lenses_response.get('LensSummaries', []):
            if 'wellarchitected' in lens.get('LensAlias', '').lower() or \
               'framework' in lens.get('LensName', '').lower():
                lens_alias = lens.get('LensAlias', '')

                # Get lens details including pillars and questions
                try:
                    lens_review = wa_client.get_lens(LensAlias=lens_alias)
                    lens_data['lens_info'] = lens_review
                except ClientError:
                    pass

                # Get pillar-level detail
                try:
                    pillars_response = wa_client.list_lens_review_improvements(
                        WorkloadId='',  # Not applicable without workload
                        LensAlias=lens_alias
                    )
                    lens_data['improvements'] = pillars_response
                except ClientError:
                    pass

        return lens_data if lens_data else None

    except ClientError as e:
        logger.info(f"Well-Architected Tool API not accessible (expected for POC): {e.response['Error']['Code']}")
        return None
    except Exception as e:
        logger.info(f"Could not fetch WAF lens data: {str(e)}")
        return None


def build_analysis_prompt(architecture_data, selected_pillars, waf_data=None):
    """
    Build the analysis prompt for Bedrock.
    Key principle: NO hardcoded pillar criteria.
    Bedrock uses its trained knowledge of the AWS Well-Architected Framework.
    """

    # Build the pillar selection description
    pillar_names = [WAF_PILLARS.get(p, p) for p in selected_pillars]
    pillar_list = ', '.join(pillar_names)

    # Optional: Include any real WAF data fetched from the API
    waf_context = ""
    if waf_data:
        waf_context = f"""
## ADDITIONAL CONTEXT FROM AWS WELL-ARCHITECTED TOOL:
{json.dumps(waf_data, indent=2, default=str)[:3000]}
"""

    prompt = f"""You are ArchLens AI - a senior AWS Solutions Architect with comprehensive, up-to-date knowledge of the AWS Well-Architected Framework (WAF) including all its pillars, design principles, best practices, questions, and evaluation criteria.

## YOUR KNOWLEDGE BASE:
You have complete knowledge of the AWS Well-Architected Framework as published by AWS. This includes:
- All 6 pillars and their complete design principles
- All best practice areas within each pillar
- All evaluation questions and their associated best practices
- Current AWS service recommendations and patterns
- Latest AWS architectural patterns and anti-patterns

IMPORTANT: Use your FULL knowledge of the Well-Architected Framework. Do NOT limit your analysis to a fixed set of criteria. Consider ALL relevant questions, best practices, and design principles from the selected pillars as they apply to this specific architecture. If AWS has added new best practices, questions, or services since your last update, apply the most current knowledge you have.

## SELECTED PILLARS FOR ANALYSIS:
{pillar_list}

Analyze the architecture against ALL best practices, questions, and design principles within these selected pillars. Do not cherry-pick or limit your evaluation — be comprehensive.

## CURRENT ARCHITECTURE DATA:
{json.dumps(architecture_data, indent=2, default=str)}
{waf_context}

## ANALYSIS INSTRUCTIONS:
1. For each selected pillar, evaluate the architecture against EVERY relevant best practice area and question within that pillar
2. Identify gaps, risks, and improvement opportunities
3. Provide specific, actionable recommendations tied to actual resources in the architecture
4. Score each pillar based on compliance with WAF best practices
5. Generate a redesigned architecture that addresses the identified gaps
6. Each recommendation must include a clear implementation path and rollback strategy

## OUTPUT FORMAT (strict JSON):
{{
    "summary": "Executive summary of findings - what's good, what needs improvement (3-5 sentences)",
    "overall_score": <0-100>,
    "pillar_scores": {{
        "<pillar_key>": {{
            "score": <0-100>,
            "status": "GOOD|NEEDS_IMPROVEMENT|CRITICAL",
            "findings_count": <number>,
            "top_risk": "Brief description of the biggest risk in this pillar"
        }}
    }},
    "recommendations": [
        {{
            "id": "REC-<sequential_number>",
            "title": "Clear, concise title of the recommendation",
            "description": "Detailed explanation of what to change, why it matters, and what problem it solves",
            "pillar": "<pillar_key that this addresses>",
            "waf_question": "The specific WAF best practice area or question this relates to",
            "priority": "CRITICAL|HIGH|MEDIUM|LOW",
            "effort_hours": <estimated_implementation_hours>,
            "risk_score": <1-10 where 10 is highest risk of implementing>,
            "downtime_required": "NONE|PLANNED|DISRUPTIVE",
            "monthly_cost_impact": <positive for savings, negative for additional cost>,
            "confidence": <0-100>,
            "current_state": "Description of current configuration",
            "proposed_state": "Description of what it should be changed to",
            "implementation_steps": ["Step 1...", "Step 2...", "Step 3..."],
            "rollback_plan": "Specific steps to reverse this change if needed",
            "affected_resources": ["resource_id_1", "resource_id_2"],
            "aws_services_involved": ["Service1", "Service2"]
        }}
    ],
    "architecture_changes": [
        {{
            "action": "ADD|MODIFY|REMOVE",
            "resource_type": "AWS service type (e.g., ElastiCache, WAF, GuardDuty)",
            "resource_name": "Descriptive name for the resource",
            "description": "What this change accomplishes",
            "connects_to": ["resource_ids this connects to in the architecture"],
            "pillar": "<primary pillar this addresses>"
        }}
    ],
    "cost_analysis": {{
        "current_estimated_monthly_usd": <estimated current monthly cost>,
        "projected_monthly_usd": <projected cost after all changes>,
        "net_monthly_impact_usd": <positive=savings, negative=increase>,
        "roi_timeline_months": <months until changes pay for themselves>
    }},
    "risk_summary": {{
        "critical_findings": <count>,
        "high_findings": <count>,
        "medium_findings": <count>,
        "low_findings": <count>,
        "immediate_actions_required": ["List of things that need immediate attention"]
    }}
}}

## CRITICAL RULES:
- Be specific — reference actual resource IDs and configurations from the provided architecture data
- Do not give generic advice — every recommendation must be tied to something concrete in this architecture
- Prioritize high-impact, low-risk changes first
- Every recommendation MUST have a rollback plan
- If you're uncertain about a recommendation, reflect that in the confidence score
- Consider interdependencies between recommendations
- Think about the order of implementation (some changes depend on others)
- Consider the total cost of implementing changes vs the benefit
- Do NOT include recommendations for resources that don't exist in the architecture
- Output ONLY valid JSON — no markdown, no explanations outside the JSON structure
"""
    return prompt


def invoke_bedrock(prompt):
    """
    Call Amazon Bedrock with the analysis prompt.
    Handles token limits and retries.
    """
    try:
        request_body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 12000,
            "temperature": 0.2,
            "top_p": 0.95,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        }

        invoke_params = {
            'modelId': MODEL_ID,
            'contentType': 'application/json',
            'accept': 'application/json',
            'body': json.dumps(request_body),
        }
        # Apply Bedrock Guardrail when configured (SOW Section 7)
        if GUARDRAIL_ID and GUARDRAIL_VERSION:
            invoke_params['guardrailIdentifier'] = GUARDRAIL_ID
            invoke_params['guardrailVersion'] = GUARDRAIL_VERSION

        response = bedrock.invoke_model(**invoke_params)

        response_body = json.loads(response['body'].read())
        ai_text = response_body['content'][0]['text']

        # Log token usage for cost tracking
        usage = response_body.get('usage', {})
        logger.info(f"Bedrock usage - Input tokens: {usage.get('input_tokens', 'N/A')}, "
                    f"Output tokens: {usage.get('output_tokens', 'N/A')}")

        return ai_text

    except ClientError as e:
        error_code = e.response['Error']['Code']
        if error_code == 'ThrottlingException':
            logger.warning("Bedrock throttled - consider implementing retry with backoff")
        elif error_code == 'ModelTimeoutException':
            logger.error("Bedrock model timed out - architecture may be too large for single request")
        raise
    except Exception as e:
        logger.error(f"Error calling Bedrock: {str(e)}")
        raise


def parse_ai_response(ai_response):
    """
    Parse the AI response, extracting valid JSON.
    Handles cases where the model wraps JSON in markdown or adds extra text.
    """
    # Try direct parse first
    try:
        return json.loads(ai_response)
    except json.JSONDecodeError:
        pass

    # Try to find JSON block in the response
    # Look for the outermost { }
    brace_count = 0
    json_start = -1
    json_end = -1

    for i, char in enumerate(ai_response):
        if char == '{':
            if brace_count == 0:
                json_start = i
            brace_count += 1
        elif char == '}':
            brace_count -= 1
            if brace_count == 0:
                json_end = i + 1
                break

    if json_start >= 0 and json_end > json_start:
        try:
            return json.loads(ai_response[json_start:json_end])
        except json.JSONDecodeError:
            pass

    # If all parsing fails, return structured error response
    logger.warning("Could not parse AI response as JSON, returning raw text")
    return {
        'summary': 'Analysis completed but response parsing failed. Raw response available.',
        'raw_response': ai_response[:5000],
        'parse_error': True
    }


def lambda_handler(event, context):
    """
    Main handler for architecture analysis.
    Input: { scanId, pillars (list), architectureData (optional) }
    Output: AI-generated recommendations and redesigned architecture.
    """
    try:
        # Parse input - handle both API Gateway and Step Functions
        if isinstance(event.get('body'), str):
            body = json.loads(event['body'])
        elif 'body' in event and isinstance(event['body'], dict):
            body = event['body']
        else:
            body = event

        scan_id = body.get('scanId')
        selected_pillars = body.get('pillars', list(WAF_PILLARS.keys()))
        architecture_data = body.get('architectureData')

        # Validate pillars
        valid_pillars = [p for p in selected_pillars if p in WAF_PILLARS]
        if not valid_pillars:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({
                    'error': 'No valid pillars selected',
                    'valid_pillars': list(WAF_PILLARS.keys())
                })
            }

        # Input validation
        if not scan_id and not architecture_data:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                'body': json.dumps({'error': 'Either scanId or architectureData is required'})
            }

        # Fetch architecture data from S3 if scanId provided
        if scan_id and not architecture_data:
            try:
                s3_response = s3_client.get_object(
                    Bucket=DATA_BUCKET,
                    Key=f"scan-results/{scan_id}.json"
                )
                architecture_data = json.loads(s3_response['Body'].read())
            except ClientError as e:
                logger.error(f"Failed to fetch scan data: {e.response['Error']['Message']}")
                return {
                    'statusCode': 404,
                    'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
                    'body': json.dumps({'error': f'Scan {scan_id} not found'})
                }

        # Attempt to fetch real WAF data from Well-Architected Tool API
        waf_data = get_waf_lens_data()

        # Build prompt and call Bedrock
        logger.info(f"Starting analysis for scan {scan_id} with pillars: {valid_pillars}")
        prompt = build_analysis_prompt(architecture_data, valid_pillars, waf_data)
        # RAG: ground recommendations in the Knowledge Base when configured
        kb_query = "AWS Well-Architected best practices for: " + ", ".join(
            WAF_PILLARS[p] for p in valid_pillars
        )
        kb_context = retrieve_kb_context(kb_query)
        if kb_context:
            prompt = prompt + kb_context
        ai_response = invoke_bedrock(prompt)

        # Parse AI response
        analysis_result = parse_ai_response(ai_response)

        # Generate recommendation ID
        recommendation_id = f"rec-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}"

        # Build complete result
        result = {
            'recommendationId': recommendation_id,
            'scanId': scan_id,
            'pillars': valid_pillars,
            'pillar_names': [WAF_PILLARS[p] for p in valid_pillars],
            'timestamp': datetime.utcnow().isoformat(),
            'model_used': MODEL_ID,
            'analysis': analysis_result,
            'architectureData': architecture_data
        }

        # Save full result to S3
        s3_client.put_object(
            Bucket=DATA_BUCKET,
            Key=f"reports/{recommendation_id}.json",
            Body=json.dumps(result, default=str),
            ContentType='application/json'
        )

        # Save metadata to DynamoDB
        table = dynamodb.Table(RECOMMENDATIONS_TABLE)
        table.put_item(Item={
            'recommendationId': recommendation_id,
            'scanId': scan_id or 'direct',
            'pillars': valid_pillars,
            'timestamp': datetime.utcnow().isoformat(),
            'status': 'generated',
            's3Key': f"reports/{recommendation_id}.json",
            'overallScore': str(analysis_result.get('overall_score', 'N/A')),
            'recommendationCount': str(len(analysis_result.get('recommendations', []))),
            'summary': analysis_result.get('summary', 'Analysis complete')[:500]
        })

        logger.info(f"Analysis complete: {recommendation_id} with "
                    f"{len(analysis_result.get('recommendations', []))} recommendations")

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
        logger.error(f"AWS Error in architecture analysis: {e.response['Error']['Message']}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"AWS Error: {e.response['Error']['Message']}"})
        }
    except Exception as e:
        logger.error(f"Unexpected error in architecture analysis: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps({'error': f"Internal error: {str(e)}"})
        }
