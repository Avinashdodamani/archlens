# ArchLens — Project Progress Report

**Project:** ArchLens — AI-Powered AWS Architecture Visualization and Optimization Platform
**Tagline:** See your architecture, optimize it with AI, and deploy changes safely in one click.
**Environment:** AWS Account 515554959344 · Region ap-south-1 (Mumbai)
**Document type:** Internal progress report
**Status:** In active development (demo-ready, pending one external dependency)

---

## 1. Executive Summary

ArchLens is a fully serverless platform that connects to a client's AWS account using a
read-only IAM role, automatically discovers their infrastructure, renders an interactive
architecture diagram, analyzes the design against the AWS Well-Architected Framework using
Amazon Bedrock, and safely generates and applies optimization changes with automatic backup
and rollback.

As of this report, the complete application is built and deployed: a React front end hosted on
S3 and CloudFront, a serverless backend of nine AWS Lambda functions behind API Gateway,
five DynamoDB tables, Cognito authentication, a Step Functions orchestration workflow,
scheduled scanning, drift detection, compliance scoring, and executive reporting.

The only capability not currently live is the AI analysis execution itself, which is blocked by
an external AWS billing/payment issue on the account (described in Section 7). All AI code is
complete and correct; it will function as soon as the billing issue is resolved.

---

## 2. High-Level Architecture

```
                         ┌──────────────────────────────┐
                         │   Amazon CloudFront (CDN)     │
                         └──────────────┬───────────────┘
                                        │
                    ┌───────────────────▼───────────────────┐
                    │   S3 (React single-page application)   │
                    └───────────────────┬───────────────────┘
                                        │  authenticated calls (JWT)
                    ┌───────────────────▼───────────────────┐
                    │   Amazon Cognito  →  API Gateway (REST) │
                    └───────────────────┬───────────────────┘
                                        │
          ┌─────────────────────────────┼─────────────────────────────┐
          ▼                             ▼                             ▼
   AWS Lambda functions        AWS Step Functions            Amazon EventBridge
   (discovery, analysis,       (end-to-end workflow)         (scheduled scans)
    scripts, backup, drift,
    report, scheduler, wf)
          │                             │
          ▼                             ▼
   Amazon Bedrock            DynamoDB · S3 · SNS · SQS · KMS
   (Claude model + Guardrail)
```

The client's AWS account is accessed only through **AWS STS AssumeRole** on a read-only role.
No client credentials are ever stored.

---

## 3. AWS Resources Created — What Each One Does

### 3.1 Compute — AWS Lambda (9 functions)

| # | Function name | Purpose | How it helps the project |
|---|---------------|---------|--------------------------|
| 1 | `archlens-resource-discovery` | Assumes the client role and scans the account across ~44 AWS services (EC2, Lambda, S3, RDS, VPC, DynamoDB, Neptune, DocumentDB, OpenSearch, GuardDuty, WAF, and many more). Also pulls Cost Explorer data for the 90-day cost trend and the per-service cost footprint. | This is the engine behind the "YourArch" tab. It produces the resource inventory and relationships that every other feature depends on. |
| 2 | `archlens-architecture-analyzer` | Sends the discovered architecture to Amazon Bedrock (Claude) and returns Well-Architected scores, prioritized recommendations, cost analysis, and a proposed design. Applies a Bedrock Guardrail and is ready to use a Knowledge Base for grounding. | Powers the "RedefineYourArch" tab — the AI intelligence core of the product. |
| 3 | `archlens-cft-generator` | Generates a CloudFormation template that implements the approved recommendations. | Turns AI advice into deployable infrastructure-as-code. |
| 4 | `archlens-terraform-generator` | Generates equivalent Terraform (HCL) scripts. | Gives clients a choice of IaC tooling. |
| 5 | `archlens-backup-manager` | Takes backups/snapshots of affected resources before any change, and performs rollback if needed. Also sends deployment success/failure notifications. | Delivers the "zero-risk implementation" promise in the "AutoRemediate" tab. |
| 6 | `archlens-drift-detector` | Compares the two most recent scans for an account and reports resources added, removed, or changed. Sends an email alert on real drift. | Powers "Drift Detection" in InsightHub — continuous monitoring of infrastructure change. |
| 7 | `archlens-report-generator` | Builds an executive-summary payload (health score, footprint, top recommendations, cost) that the UI exports as a PDF. | Provides leadership-ready reporting. |
| 8 | `archlens-scan-scheduler` | Reads client-defined schedules (one-time or daily) and triggers discovery + drift automatically when due. Supports create/list/enable/disable/delete. | Powers "Scheduled Scans" — hands-free continuous scanning. |
| 9 | `archlens-workflow-manager` | Starts and monitors the Step Functions workflow, and auto-advances its approval steps so the full lifecycle runs end to end. | Powers the "Run via Workflow" orchestration feature. |

**Why Lambda:** serverless, pay-per-invocation, and effectively free at demo scale. No servers to
manage and it scales automatically.

### 3.2 API Layer — Amazon API Gateway

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| `archlens-api` (REST API) | Single secure entry point for the front end. Routes: `/discover`, `/analyze`, `/generate-cft`, `/generate-terraform`, `/backup`, `/detect-drift`, `/generate-report`, `/schedule`, `/workflow`. Protected by a Cognito authorizer with CORS enabled. | Gives the browser one authenticated, throttled, HTTPS endpoint to reach all backend functions. |

### 3.3 Authentication — Amazon Cognito

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| `archlens-user-pool` | Manages user sign-up, sign-in, email verification, and JWT tokens. | Secures the platform. Every API call is authorized with a Cognito-issued token; no custom auth to maintain. |

### 3.4 Data Layer — Amazon DynamoDB (5 tables)

| Table | Purpose | How it helps |
|-------|---------|--------------|
| `archlens-scans` | Metadata for every discovery scan (account, region, resource count, S3 pointer). | Enables scan history, comparison, and drift detection. |
| `archlens-recommendations` | Metadata for every AI analysis run. | Links analyses back to scans and feeds reports. |
| `archlens-schedules` | Client-defined scan schedules (frequency, time, enabled state). | Drives the scheduled-scan feature with per-schedule control. |
| `archlens-users` | User profile/preferences store. | Supports account-level data. |
| `archlens-audit` | Audit log of actions. | Traceability and compliance. |

**Why DynamoDB:** serverless, single-digit-millisecond latency, pay-per-request, and no
connection management. (The project design allowed a graph database as an alternative — see
Section 6.)

### 3.5 Storage — Amazon S3 (3 buckets)

| Bucket | Purpose | How it helps |
|--------|---------|--------------|
| `archlens-frontend-515554959344` | Hosts the built React application. | Static, cheap, globally distributed via CloudFront. |
| `archlens-data-515554959344` | Stores full scan results, analysis reports, generated scripts, and the Well-Architected knowledge corpus. | Keeps large JSON payloads out of DynamoDB and cheap to store. |
| `archlens-backups-515554959344` | Stores pre-change backup artifacts and exports. | Supports safe rollback. |

### 3.6 Content Delivery — Amazon CloudFront

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| Distribution `E2W2DGJSOIAERC` (`d2gsocwzfyrda.cloudfront.net`) | Serves the front end globally over HTTPS with caching. | Fast load times worldwide and a single public URL for the app. |

### 3.7 Orchestration — AWS Step Functions

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| `archlens-workflow` (state machine) | Orchestrates the full lifecycle: discover → analyze → generate scripts (in parallel) → backup → deploy → health check → rollback on failure. Includes automatic retries. | Runs the entire process server-side with built-in error handling and auto-rollback, independent of the browser. |

### 3.8 Eventing and Messaging

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| `archlens-scheduled-scan` (EventBridge rule) | Fires hourly and triggers the scheduler Lambda to run any due schedules. | Enables cron-based automatic scanning. |
| `archlens-workflow-status` (EventBridge rule) | Captures workflow status events. | Supports monitoring of orchestration runs. |
| `archlens-notifications` (SNS topic) | Sends email alerts for drift and deployment status. | Keeps users informed without opening the app. |
| `archlens-approval-queue` (SQS queue) | Holds human-approval "pause" messages for the Step Functions workflow. | Enables the approval gates in the orchestrated lifecycle. |

### 3.9 AI / Machine Learning — Amazon Bedrock

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| Bedrock foundation model (Claude) | Analyzes architecture against the Well-Architected Framework and generates recommendations and IaC. | The core intelligence of the platform. |
| `archlens-guardrail` (Bedrock Guardrail) | Blocks unsafe or irrelevant AI output and protects against prompt injection and credential leakage. | Improves trust and reduces AI hallucination risk. |
| Knowledge corpus in S3 (`knowledge-base/`) | Well-Architected and CIS best-practice text, ready for a Bedrock Knowledge Base (RAG). | Prepared so recommendations can be grounded in official AWS guidance when enabled. |

### 3.10 Security and Encryption

| Resource | Purpose | How it helps |
|----------|---------|--------------|
| AWS STS AssumeRole (read-only) | Temporary, least-privilege access to the client account. | No client credentials are ever stored; access is revocable and time-limited. |
| AWS KMS | Encryption of data at rest. | Meets security and compliance expectations. |
| `archlens-lambda-execution-role` (IAM) | Execution permissions for all Lambda functions. | Centralized, least-privilege backend permissions. |

---

## 4. Front-End Application (React on S3 + CloudFront)

Five main sections, matching the product design:

| Tab | What it does |
|-----|--------------|
| **Dashboard** | Health score gauge, Well-Architected radar chart, real cost trend (from the client's Cost Explorer data), recommendations, resource distribution, and recent scans with trend indicators. |
| **YourArch** | Connect a read-only role, discover the account, and view an interactive diagram with five view modes (Logical, Network, Data Flow, Cost, Security). Supports tag-based grouping, per-scan notes, and export to PNG, SVG, PDF, and draw.io. Includes "Run via Workflow" orchestration. |
| **RedefineYourArch** | Select Well-Architected pillars, run AI analysis, and view scored recommendations with a current-versus-proposed comparison and generated CloudFormation/Terraform scripts. |
| **AutoRemediate** | Take backups, preview the change set, deploy, and roll back — with safety guardrails and a clear step-by-step progress view. |
| **InsightHub** | Scan history, compliance dashboard (CIS/NIST), drift detection, scan comparison, scheduled scans, and executive PDF report export. |

Platform-wide features: command palette (Ctrl/Cmd+K) for quick navigation and search, a
notification center with real read/unread tracking, an AI assistant helper, a first-time
onboarding tour, and a consistent Inter-based typography and color system.

---

## 5. Problems and Blockers

### 5.1 Amazon Bedrock billing/payment (external — currently blocking AI features)
- **Symptom:** Bedrock model invocation fails with an `INVALID_PAYMENT_INSTRUMENT` error;
  the model agreement shows as unavailable.
- **Root cause:** An AWS account billing/card validation issue (common with certain cards and
  the AWS Marketplace agreement that Bedrock models require). This is **not a code problem** —
  the analyzer, guardrail, and prompt logic are complete and correct.
- **Impact:** The AI analysis (RedefineYourArch) and any workflow step that calls Bedrock cannot
  complete until billing is resolved. Everything else (discovery, diagram, drift, scheduling,
  reports, compliance) works today.
- **Resolution path:** Validate/re-add a payment method in AWS Billing, enable the model
  agreement in Bedrock, or open a free AWS Billing support case. No code change required.

### 5.2 Bedrock Knowledge Base (deferred on cost)
- The Retrieval-Augmented Generation (RAG) feature requires a vector store. The standard AWS
  option (OpenSearch Serverless) carries a continuous monthly cost (roughly a few hundred USD).
- **Decision:** The knowledge corpus and the code path are ready, but the vector store has not
  been provisioned to avoid standing cost during development. It can be enabled for production.

### 5.3 Real deployment step is a controlled placeholder
- In AutoRemediate and the Step Functions workflow, the actual "apply changes" step is currently
  a safe placeholder rather than a live CloudFormation deploy, because a real deploy is
  destructive and needs a dedicated target account and explicit approval. Backup, change-set
  preview, and rollback are fully implemented.

### 5.4 Client-side prerequisites for full data
- **AWS Config:** For 100% coverage of untagged resources and richer relationships, the client
  account needs AWS Config enabled. Without it, discovery still covers ~44 services directly and
  all tagged resources, plus billed services from Cost Explorer.
- **Cost Explorer:** The cost trend and cost view require Cost Explorer access in the client
  role; otherwise those panels show an empty state (never fake values).

---

## 6. Cost-Conscious Choices — Alternatives for Production

The following table lists where a lower-cost or simpler service was chosen for development, and
the recommended production alternative.

| Area | Currently used (dev) | Recommended for production | Reason |
|------|----------------------|----------------------------|--------|
| Relationship / graph storage | DynamoDB (adjacency pattern) | Amazon Neptune (managed graph database) | DynamoDB is free-tier friendly and sufficient for the diagram. Neptune is better for very large, deeply connected graphs but adds standing cost. The design explicitly allows either. |
| AI grounding (RAG) | Not provisioned (corpus staged in S3) | Bedrock Knowledge Base backed by OpenSearch Serverless (or Aurora Serverless pgvector) | Vector stores bill continuously; enable in production to ground AI answers in official AWS documentation. |
| Search / log analytics | Client-side filtering + DynamoDB | Amazon OpenSearch Service | Fine at current scale; OpenSearch is warranted only at large data volumes. |
| Caching / session store | Browser state + DynamoDB | Amazon ElastiCache (Redis) | Avoids a standing cache cost during development; add in production for high traffic. |
| Scheduled scans | One shared EventBridge rule + scheduler Lambda | Amazon EventBridge Scheduler (one schedule per client) | The shared-dispatcher pattern avoids per-schedule infrastructure; EventBridge Scheduler is cleaner at scale. |
| AI model routing | Single Claude model | Model routing (Haiku for quick checks, Sonnet for standard, Opus for complex) | Saves cost by matching model size to task complexity. |
| Infrastructure deployment | Manual CLI + console | AWS CDK or CloudFormation with CodePipeline/CodeBuild | Development used direct deployment for speed; production should use full infrastructure-as-code and CI/CD. |
| Observability | CloudWatch Logs | CloudWatch + X-Ray distributed tracing + RUM | Add deeper tracing and real-user monitoring for production support. |

**General principle:** every service chosen for development is serverless and pay-per-use, so the
running cost at demo scale is effectively zero. The production alternatives above trade a
predictable monthly cost for greater scale, richer features, or stronger operations.

---

## 7. Current Status Summary

| Capability | Status |
|------------|--------|
| Resource discovery (multi-service, multi-region) | Working |
| Interactive architecture diagram (5 views) | Working |
| Diagram export (PNG, SVG, PDF, draw.io) | Working |
| Tag-based grouping and per-scan notes | Working |
| Cost trend and cost view (real account data) | Working |
| Drift detection and email alerts | Working |
| Scan comparison | Working |
| Scheduled scans (one-time and daily) | Working |
| Compliance dashboard (CIS / NIST) | Working |
| Executive PDF report | Working |
| Step Functions orchestration | Working |
| Notifications with read/unread tracking | Working |
| Backup, change-set preview, rollback | Working |
| Cognito authentication | Working |
| AI analysis (Bedrock) | Blocked by account billing (Section 5.1) |
| Live CloudFormation deploy | Controlled placeholder (Section 5.3) |
| Bedrock Knowledge Base (RAG) | Ready, deferred on cost (Section 5.2) |

---

## 8. Deployment Reference

- **Front end:** built with Vite, synced to `s3://archlens-frontend-515554959344/`, served via
  CloudFront distribution `E2W2DGJSOIAERC`.
- **Backend:** nine Lambda functions deployed in `ap-south-1`, fronted by the `archlens-api`
  REST API with a Cognito authorizer.
- **Account:** 515554959344 · Region ap-south-1 (Mumbai).

---

*Prepared for internal review. All resource names and identifiers reflect the live development
environment at the time of writing.*
