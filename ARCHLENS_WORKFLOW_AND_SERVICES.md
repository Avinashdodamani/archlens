# ArchLens — End-to-End Workflow & Architecture Guide

> **Official Demo & Presentation Guide**  
> *Production-Ready Multi-Region Cloud Intelligence, WAF Analysis & AI Remediation*

---

## 1. Service Discovery Matrix (What & How It Analyzes)

ArchLens uses a **3-tier discovery pipeline** designed to achieve **100% cloud resource visibility** without manual intervention:

| Discovery Method | AWS Services Covered | How It Identifies Resources | Depth of Analysis |
| :--- | :--- | :--- | :--- |
| **Tier 1: Dedicated Scanners**<br>*(50+ Core Services)* | **Compute:** EC2, Lambda, ECS, EKS, AutoScaling, Batch, App Runner, Elastic Beanstalk<br>**Networking:** VPC, Subnets, Security Groups, Internet Gateways, NAT Gateways, Transit Gateways, Route 53, CloudFront, API Gateway (REST & HTTP/WebSocket)<br>**Databases & Caching:** RDS, DynamoDB, ElastiCache, Redshift, Neptune, DocumentDB, OpenSearch<br>**Storage & Backup:** S3, EBS, EFS, FSx, AWS Backup (Plans & Vaults)<br>**Security & IAM:** IAM Users, IAM Roles, KMS, Secrets Manager, AWS WAFv2, GuardDuty, Security Hub, Cognito<br>**Integration & Analytics:** Step Functions, EventBridge, SNS, SQS, Kinesis, Glue, Athena, EMR, AppSync, SageMaker<br>**Management:** CloudWatch (Alarms), CloudTrail, AWS Config, SSM, CodeDeploy | **Direct AWS Service APIs:**<br>Uses parallelized Describe* and List* SDK calls per region. | **Deep Inspection:** Evaluates encryption status (SSE-KMS, TLS), public accessibility, Multi-AZ failover, CIDRs, tags, versioning, and IAM permission bindings. |
| **Tier 2: Catch-All Discovery**<br>*(100+ AWS Services)* | **Any other deployed AWS resource** (e.g., CodeBuild, Bedrock Guardrails/Models, Lake Formation, Cloud9, etc.) | **AWS Config Advanced Query (SelectResourceConfig) + AWS Resource Groups Tagging API (GetResources):**<br>Discovers **both tagged and untagged** resources recorded across all enabled regions. | **Inventory & Relationships:** Identifies the resource ARN, metadata, and AWS-native dependency relationships. |
| **Tier 3: Cost Footprint Verification**<br>*(All 200+ AWS Services)* | **Entire AWS Service Catalog** with active billing items | **AWS Cost Explorer API (GetCostAndUsage):**<br>Queries active billing lines over the past 30, 60, and 90 days. | **Financial Audit:** Guarantees that any service incurring cost is flagged even if it lives in a remote or unlisted region. |

---

## 2. Complete End-to-End ArchLens Workflow

`mermaid
flowchart TD
    %% Styling
    classDef onboard fill:#1e293b,stroke:#38bdf8,stroke-width:2px,color:#fff;
    classDef discover fill:#0f172a,stroke:#34d399,stroke-width:2px,color:#fff;
    classDef waf fill:#3b0764,stroke:#c084fc,stroke-width:2px,color:#fff;
    classDef iac fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#fff;
    classDef ops fill:#064e3b,stroke:#2dd4bf,stroke-width:2px,color:#fff;

    subgraph STAGE1[STAGE 1 · Secure Onboarding]
        A[Client Account] -->|1-Click CloudFormation / Terraform| B[IAM Read-Only Role<br/>(SecurityAudit + ReadOnlyAccess)]
        B -->|STS AssumeRole| C[ArchLens Platform<br/>(Zero Long-Lived Credentials)]
    end
    class STAGE1 onboard;

    subgraph STAGE2[STAGE 2 · Multi-Region Discovery (YourArch)]
        C --> D[Auto-Detect Active Regions<br/>(ec2.describe_regions)]
        D --> E1[Tier 1: 50+ Dedicated Scanners]
        D --> E2[Tier 2: AWS Config & Tagging API]
        D --> E3[Tier 3: Cost Explorer Billing]
        E1 & E2 & E3 --> F[Deduplication & Relationship Mapping]
        F --> G1[Persist Scan:<br/>• DynamoDB (archlens-scans)<br/>• S3 (Full JSON Topology)]
        F --> G2[Render 2D Architecture Diagram<br/>(ReactFlow with Official AWS Icons)]
    end
    class STAGE2 discover;

    subgraph STAGE3[STAGE 3 · AI Architecture Evaluation (RedefineYourArch)]
        G1 --> H[Amazon Bedrock<br/>(Amazon Nova Pro Model)]
        H --> I[Evaluate 6 AWS WAF Pillars:<br/>1. Security 2. Reliability 3. Cost<br/>4. Performance 5. Ops 6. Sustainability]
        I --> J[Generate Health Score (0-100)<br/>+ Prioritized Recommendations (REC-001...)<br/>+ Exact Rollback Plans]
        J --> K[Save Analysis to S3 & DynamoDB]
    end
    class STAGE3 waf;

    subgraph STAGE4[STAGE 4 · Automated Remediation (AutoRemediate)]
        K --> L[User Selects Recommendation]
        L --> M1[Generate CloudFormation Template]
        L --> M2[Generate Terraform Code]
        M1 & M2 --> N[1-Click Download or Deploy via Step Functions<br/>(Automated Pre-Change Backup Snapshot + Human Gate)]
    end
    class STAGE4 iac;

    subgraph STAGE5[STAGE 5 · Continuous Intelligence (InsightHub)]
        G1 --> O[Visual Architecture Drift Detection<br/>(Live Diff against Baseline Scan)]
        G1 --> P[EventBridge Automated Scheduler<br/>(Daily / Weekly / Custom cron)]
        P -->|Scan Finishes| Q[Amazon SNS Email Report<br/>(Automated Detailed Success / Failure Status)]
    end
    class STAGE5 ops;
`

---

## 3. Real-Time AI Chatbot Workflow & Grounding Architecture

Clients and leadership frequently ask:  
> *Is the chatbot just giving generic ChatGPT answers, or does it know our actual AWS environment?*

The ArchLens AI Assistant uses a **Deterministic Grounding Architecture** that directly queries the active scan and Amazon Bedrock Nova Pro. It has strict directives to **never fabricate dates, fake dollar savings, or invent resources**.

`mermaid
sequenceDiagram
    autonumber
    actor User as User / Client
    participant UI as React UI (AiAssistant.tsx)
    participant API as Amazon API Gateway
    participant Lambda as archlens-architecture-analyzer
    participant S3 as Amazon S3 (archlens-data)
    participant Bedrock as Amazon Bedrock (Nova Pro + Guardrail)

    User->>UI: Asks question (e.g. How can I reduce AWS cost? or Are my databases encrypted?)
    UI->>API: POST /chat { question, scanId, currentSessionContext }
    API->>Lambda: Trigger chat handler

    alt Full topology present in session?
        Lambda->>Lambda: Extract real in-memory resources
    else Only scanId provided?
        Lambda->>S3: Retrieve scan-results/{scanId}.json
        S3-->>Lambda: Return 59 live discovered resources
    end

    Note over Lambda: Injects Real Account Context into Nova Prompt:<br/>• Live Account ID (515554959344) & Real Scan Timestamp<br/>• Real Resource Counts by Type (5 DynamoDB, 9 Lambda, 2 VPCs...)<br/>• Real WAF Scores & Cost Explorer footprint<br/>• Strict Directive: If not scanned, ask user to scan first

    Lambda->>Bedrock: invoke_model(apac.amazon.nova-pro-v1:0) with Guardrail (303z1lw3qgz1)
    Bedrock-->>Lambda: Generates accurate, authoritative response
    Lambda-->>API: 200 OK with verified answer
    API-->>UI: Return response stream
    UI-->>User: Displays verified, grounded recommendations tied to real resource ARNs
`

---

## 4. Architectural Summary for Presentations

| Feature | Technical Architecture | Business / Enterprise Value |
| :--- | :--- | :--- |
| **Security & Permissions** | Read-Only IAM Role (SecurityAudit, ReadOnlyAccess) | **100% Non-Disruptive:** Zero risk of downtime, stops, or accidental modification. |
| **Cost Model** | 100% Serverless (Lambda, API Gateway, DynamoDB On-Demand, S3) | **Zero Idle Cost:** .00 when not running. Analysis with Bedrock Nova Pro costs ~\.015 per scan. |
| **Speed & Resilience** | Region auto-detection (AllRegions=False) + ThreadPoolExecutor | **<22s Multi-Region Discovery:** Avoids API Gateway 29-second HTTP timeout. |
| **AI Evaluation** | Amazon Bedrock (**Amazon Nova Pro** in p-south-1) | **AWS Well-Architected Framework Compliance:** Scored across all 6 pillars with verifiable rollback paths. |
| **Persistence** | AWS DynamoDB (rchlens-scans) + Amazon S3 | **Full Audit Trail:** Scans and reports survive page reloads and browser clears. |
