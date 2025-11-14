# Distributed Notification System

## 1. Purpose
A modular, horizontally scalable platform for producing, routing, scheduling, and delivering user notifications across multiple channels with strong reliability, observability, and extensibility guarantees.

## 2. Core Design Principles
- Microservice isolation
- Event-driven flow over tight coupling
- Idempotent operations
- Configuration over code for channel expansion
- Graceful degradation under partial failure
- Security and auditability baked in

## 3. High-Level Architecture
Five independently deployable microservices plus shared infrastructure (message broker, persistence, cache, tracing, metrics). Services communicate primarily via asynchronous events; synchronous calls are minimized to read/query paths.

Data and control flow:
Client -> api-gateway -> template-service + user-service -> email-service / push-service -> status events -> persistence and analytics.

## 4. Microservices Overview
1. api-gateway: Public entry point. Accepts external API requests, validates payloads, applies idempotency keys, enriches via template-service and user-service as needed, and publishes channel requests.
2. template-service: Manages and renders templates. Supports versioning, localization, and placeholder substitution. Exposes synchronous APIs for rendering and metadata.
3. user-service: Manages users, channel endpoints, and preferences (opt-ins, quiet hours, fallbacks). Exposes read APIs used by api-gateway and channel services.
4. email-service: Consumes email delivery requests, integrates with email providers, handles retries, bounces, and rate limiting. Emits delivery outcome events.
5. push-service: Consumes push delivery requests, integrates with push providers, manages device tokens, TTL, and retries. Emits delivery outcome events.

## 5. Communication Patterns
- Primary: Publish/subscribe via the message broker for channel requests and delivery outcomes.
- Example topics: notification.email.requested, notification.push.requested, notification.email.delivered/failed, notification.push.delivered/failed.
- Synchronous calls: api-gateway -> template-service and -> user-service (lookup/preferences).
- Dead-letter queues for poison messages.
- Outbox pattern for reliable event publication from transactional boundaries.

## 6. Message Taxonomy
- notification.intent.received
- notification.intent.enriched
- notification.email.requested
- notification.push.requested
- notification.email.delivered / notification.email.failed / notification.email.bounced
- notification.push.delivered / notification.push.failed

Each event includes: idempotency key, correlation id, tenant id, source, trace id, schema version.

## 7. Data Model Highlights
- NotificationIntent: id, recipient, channel targets, template id, payload, metadata.
- DeliveryAttempt: intent id, channel, provider message id, status, timestamps, error classification.
- Template: versioned content with placeholders and localization.
- UserChannelPreference: opt-ins, quiet hours, fallback ordering, addresses/tokens.

## 8. Reliability and Idempotency
- Write path guarded by idempotency key on intent creation.
- Delivery adapters enforce at-least-once externally but exactly-once internally using attempt registry.
- Retry strategy: exponential backoff with jitter; max attempts per channel; circuit breaker on provider errors.
- DLQ consumption job with triage tagging.

## 9. Configuration
Environment variables (12-factor aligned):
- BROKER_URL, DB_URL, CACHE_URL
- CHANNEL_ENABLE_LIST
- RATE_LIMIT_GLOBAL / RATE_LIMIT_CHANNEL_X
- PROVIDER_CREDENTIALS_*
- RETRY_MAX_ATTEMPTS
- SCHEDULE_TIMEZONE_DEFAULT
Central config service or file-based fallback during local dev.

## 10. Local Development
Prerequisites: runtime versions (language(s) used per service), container engine, Makefile or task runner, message broker (e.g., Kafka/RabbitMQ), database (e.g., PostgreSQL), cache (e.g., Redis).
Typical flow:
1. Start infrastructure via docker compose.
2. Start each service with hot-reload.
3. Seed templates and mock users.
4. Send a sample request via api-gateway.
5. Observe event flow with broker UI + tracing dashboard.

## 11. Deployment
- Container images per service with minimal base.
- Infrastructure-as-code (Terraform/Helm).
- Blue/green or rolling strategy.
- Migrations gated by backward-compatible changes first.
- Versioned event schemas; consumers tolerant to additive fields.

## 12. Observability
- Structured JSON logging with correlation ids.
- Distributed tracing (trace id propagated in headers + events).
- Metrics: intent_ingest_rate, email_delivery_latency_p95, push_delivery_latency_p95, retry_count, failure_ratio_per_channel.
- Health endpoints: liveness (process), readiness (dependencies).
- Alerting thresholds on failure ratio and backlog growth.

## 13. Security
- AuthN: API keys or OAuth2 for external clients.
- AuthZ: Role-based access for reporting queries.
- Data: PII minimized; encryption at rest and in transit (TLS).
- Secrets via vault or managed secret store.
- Audit log for template changes and manual replays.

## 14. Scaling Strategy
- Horizontal scaling by partitioning intents on tenant or hash of user id.
- email-service and push-service scale independently based on provider throughput.
- template-service and user-service cache hot data to reduce DB read pressure.

## 15. Failure Handling
- Graceful degradation: fallback channel if primary fails.
- Bulk suppression if systemic provider outage detected.
- Automatic quarantine of anomalous templates causing spikes.
- Replay tooling for DLQ messages with controlled rate.

## 16. Testing Strategy
- Unit: pure logic (templating, enrichment rules).
- Contract: event schema validation.
- Integration: broker + DB interactions in ephemeral environment.
- End-to-end: synthetic intent lifecycle.
- Load: spike and soak around peak expected TPS.
- Chaos experiments: broker partition loss, provider latency injection.

## 17. CI/CD
Pipeline stages: lint -> unit -> contract tests -> integration -> security scan -> image build -> deploy to staging -> e2e -> canary -> production.
Automated schema diff check; prevents breaking removals.

## 18. Versioning and Compatibility
- Semantic versioning per service.
- Event schemas versioned; subscribers declare supported versions.
- Deprecation policy with sunset timeline and broadcast notices.

## 19. Conventions
- Folder layout per service: src, tests, config, migrations, docs.
- Consistent naming: snake_case for event keys, kebab-case for container names.
- Timestamps in UTC ISO-8601.
- Avoid cross-service direct DB access.

## 20. Extending Channels
Steps:
1. Define channel adapter interface implementation.
2. Add provider credential mapping.
3. Register routing strategy rules.
4. Add metrics and failure classification mapping.
5. Document configuration toggles.

## 21. Performance Considerations
- Batch grouping for identical template/channel pairs.
- Async I/O for external provider calls.
- Circuit breakers and connection pooling.
- Pre-render templates where personalization minimal.

## 22. Troubleshooting
Symptoms and likely causes:
- High retry count: provider partial outage or throttling.
- Backlog growth: insufficient consumer partitions or slow rendering/lookups.
- Missing deliveries: preference-based suppression or invalid channel address/token.
- Duplicate sends: idempotency key misuse or replay without guard.

## 23. Roadmap (Indicative)
- Add webhook channel.
- ML-based send-time optimization.
- Multi-tenant quota enforcement.
- Real-time preference management UI.
- Advanced A/B template experimentation.
- Policy-driven compliance (GDPR purge automation).

## 24. Operational Runbook (Summary)
Incident triage priority: delivery outage > ingestion halt > reporting lag.
Initial steps: confirm broker health, check failure metric spikes, inspect DLQ volume, verify external provider status page.

## 25. Glossary
Intent: Abstract request to notify one or more recipients.
Enrichment: Process of attaching personalization and template rendering context.
Schedule: Rule set determining deferred execution.
Delivery Attempt: Single channel execution try.
DLQ: Holding queue for unprocessable messages.

## 26. Getting Started Quick Start
1. Clone repository.
2. Launch infrastructure.
3. Start all services locally.
4. POST a sample request to api-gateway.
5. Query api-gateway status endpoints or inspect metrics for a status summary.

## 28. Contribution Guidelines
Branch naming, commit style, code review minimum approvals, schema change checklist.

## 29. Disclaimer
This README reflects the current services: api-gateway, email-service, push-service, template-service, and user-service.

