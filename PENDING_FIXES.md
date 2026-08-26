# ArchLens - Pending Fixes & Changes

## ✅ COMPLETED

### 1. Architecture Diagram — Professional Layout (Major Rework) ✅
- Reworked `ArchitectureDiagram.tsx` with proper AWS boundaries:
  - AWS Cloud boundary (solid border)
  - VPC boundary (purple solid border) inside cloud
  - Public subnet (dashed green border) inside VPC
  - Private subnet (dashed blue border) inside VPC
  - Services placed correctly per AWS standards:
    - OUTSIDE VPC: CloudFront, Route53, S3, IAM, Cognito, DynamoDB, SNS, SQS, APIGateway, etc.
    - VPC-LEVEL: SecurityGroup, InternetGateway, NATGateway
    - INSIDE Subnets: EC2, RDS, ELB (public), Lambda, ECS, EKS (private)
- Created `src/config/aws-theme.ts` — ALL colors extracted from PPT decks:
  - AWS-Architecture-Icons-Deck_For-Dark-BG_07312026.pptx
  - AWS-Architecture-Icons-Deck_For-Light-BG_07312026.pptx
- To update colors in future: replace PPTs → update aws-theme.ts values
- Diagram background + icons switch with dashboard theme (dark/light)

### 2. SNS Notification — Only on Deploy Success/Fail ✅
- Email sent ONLY when:
  - Deployment succeeds (after client approves changes) → "Deployment Successful ✅"
  - Deployment fails / rollback → "Deployment FAILED ❌"
- NO email sent when:
  - First time viewing architecture diagram
  - Taking backups (pre-deployment step)
- Added `deploy_success` and `deploy_failed` actions to backup-manager Lambda
- Rollback action still sends notification (was already there)

### 3. Bedrock Model ID ✅
- All 3 Lambdas now use `os.environ['MODEL_ID']` — no hardcoded fallback
- Set env var: `MODEL_ID=apac.anthropic.claude-3-5-sonnet-20241022-v2:0`

### 4. Cost — From Bedrock Only ✅
- Cost data shown exactly as returned by Bedrock (no custom before/after calculations)
- Shows: Current Monthly, Projected Monthly, Net Impact, ROI Timeline
- All values come from Bedrock's `cost_analysis` response
- Removed Cost Explorer tab entirely (cost is shown in RedefineYourArch after analysis)

### 5. Cost Explorer Tab Removed ✅
- Removed from Sidebar navigation
- Removed from App.tsx routes
- Deleted CostExplorerPage.tsx
- Cost info appears in RedefineYourArch page after Bedrock analysis

### 6. Download Fix (PNG/SVG/PDF) ✅
- Export background respects current theme
- Link appended to document.body before clicking, then removed
- Targets `.react-flow` element correctly

### 7. Light/Dark Theme — Full Diagram Support ✅
- Dashboard theme change → diagram background switches
- Icons switch between `/aws-icons/dark/` and `/aws-icons/light/`
- Boundary colors have dark/light variants (from both PPTs)
- Node backgrounds, text colors, panels all adapt

## Already Fixed (Deploy Pending)
- Profile: Shows email username, no UUID, no Role/Plan
- Timestamp: Reverted to toLocaleString()
- InsightHub: Cost removed, View button added for scan history
- Scan numbering: Position-based (1,2,3)
- Notification bell: Removed

## Deploy Notes
- Lambda env var required: `MODEL_ID=apac.anthropic.claude-3-5-sonnet-20241022-v2:0`
- Set `SNS_TOPIC_ARN` env var on backup-manager Lambda for deploy notifications
- Run `npm run build` in frontend/ and deploy dist/ to S3/CloudFront
