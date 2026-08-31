# AWS Well-Architected Framework — Knowledge Corpus (ArchLens RAG)

This corpus grounds ArchLens AI recommendations in AWS best practices (SOW Section 7).
Upload to the Bedrock Knowledge Base S3 data source and sync.

## Operational Excellence
- Perform operations as code (IaC via CloudFormation/CDK/Terraform).
- Make frequent, small, reversible changes.
- Anticipate failure; learn from operational events.
- Key services: CloudFormation, CloudWatch, Systems Manager, CodePipeline, X-Ray.
- Common recommendations: add CloudWatch dashboards, implement CI/CD, create SSM runbooks, enable structured logging.

## Security
- Implement a strong identity foundation (least privilege, centralized IAM).
- Enable traceability (CloudTrail, Config, GuardDuty, Security Hub).
- Apply security at all layers; encrypt data at rest and in transit (KMS, TLS 1.2+).
- Automate security best practices; prepare for security events.
- Common recommendations: enforce MFA, enable GuardDuty, rotate keys, restrict security-group rules to least privilege, block public S3 access, enable default encryption.

## Reliability
- Automatically recover from failure; test recovery procedures.
- Scale horizontally to increase aggregate availability.
- Stop guessing capacity; manage change through automation.
- Key patterns: Multi-AZ, Auto Scaling, cross-region DR, backups.
- Common recommendations: enable Multi-AZ RDS, add Auto Scaling groups, implement cross-region DR, configure automated backups with defined RPO/RTO.

## Performance Efficiency
- Democratize advanced technologies; use serverless where possible.
- Go global in minutes; experiment more often.
- Key patterns: right-sizing, caching, CDN, read replicas.
- Common recommendations: right-size EC2 (consider Graviton), add ElastiCache, enable CloudFront, use RDS read replicas.

## Cost Optimization
- Adopt a consumption model; measure overall efficiency.
- Stop spending on undifferentiated heavy lifting; analyze and attribute expenditure.
- Common recommendations: delete unused EIPs/EBS volumes, switch to Graviton, buy Savings Plans/Reserved Instances, optimize NAT Gateway usage, use S3 lifecycle policies and storage tiering.

## Sustainability
- Maximize utilization; adopt managed services.
- Reduce downstream impact of workloads.
- Common recommendations: migrate to Fargate/serverless, implement S3 lifecycle, use ARM/Graviton instances, right-size to reduce idle capacity, select regions with lower carbon intensity.

## CIS AWS Foundations Benchmark (selected)
- Avoid use of the root account; enable MFA on root.
- Ensure CloudTrail is enabled in all regions and log file validation is on.
- Ensure S3 buckets are not publicly readable/writable unless required.
- Ensure security groups do not allow 0.0.0.0/0 to sensitive ports (22, 3389).
- Ensure EBS volumes and RDS instances are encrypted.
