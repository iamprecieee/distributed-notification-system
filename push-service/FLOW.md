# Push Service Flow

## Overview
The Push Service is a background worker that consumes messages from RabbitMQ, fetches and renders templates, sends push notifications via Firebase Cloud Messaging (FCM), and logs delivery status.

## Complete Flow

### 1. Message Consumption
**Source**: RabbitMQ `push.queue`

**Message Format**:
```json
{
  "trace_id": "a3f5b9c1-2d4e-4a5f-9b2c-7e8d9f1a2b3c",
  "idempotency_key": "notif_8f3d9a1c2b4e5f6a7b8c9d0e1f2a3b4c",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "notification_type": "push",
  "recipient": "fcm_device_token_xyz123",
  "template_code": "welcome_notification",
  "variables": {
    "name": "John Doe",
    "link": "https://example.com/welcome"
  },
  "language": "en",
  "metadata": {}
}
```

**Configuration**:
- Prefetch count: 10 messages
- Concurrent workers: 10 tasks

### 2. Idempotency Check
**Action**: Check Redis for duplicate processing

**Redis Key**: `idempotency:{idempotency_key}`

**Logic**:
- If key exists with value `"sent"` → Acknowledge message and skip (already delivered)
- If key exists with value `"processing"` → Requeue message (another worker is handling it)
- If key doesn't exist → Continue to next step

### 3. Mark as Processing
**Action**: Set idempotency key in Redis

**Redis Operation**:
```
SET idempotency:{idempotency_key} "processing" EX 86400
```

This prevents duplicate processing if the message is redelivered.

### 4. Fetch Template
**Action**: HTTP GET request to Template Service

**Endpoint**: `GET {TEMPLATE_SERVICE_URL}/api/v1/templates/{template_code}`

**Example**: `GET http://template-service:8084/api/v1/templates/welcome_notification`

**Response**:
```json
{
  "id": "uuid",
  "code": "welcome_notification",
  "type": "push",
  "language": "en",
  "version": 2,
  "content": {
    "title": "Welcome {{name}}!",
    "body": "Hi {{name}}, click {{link}} to begin."
  },
  "variables": ["name", "link"]
}
```

**Resilience**: 
- Circuit breaker protects against Template Service failures
- Retry with exponential backoff on transient errors

### 5. Render Template
**Action**: Replace template variables with actual values

**Input**:
- Template: `"Welcome {{name}}! Visit: {{link}}"`
- Variables: `{"name": "John Doe", "link": "https://example.com/welcome"}`

**Output**:
- Rendered: `"Welcome John Doe! Visit: https://example.com/welcome"`

### 6. Send Push Notification
**Action**: HTTP POST request to Firebase Cloud Messaging

**Endpoint**: `POST https://fcm.googleapis.com/fcm/send`

**Headers**:
```
Authorization: key={FCM_SERVER_KEY}
Content-Type: application/json
```

**Payload**:
```json
{
  "to": "fcm_device_token_xyz123",
  "notification": {
    "title": "Welcome John Doe!",
    "body": "Welcome John Doe! Visit: https://example.com/welcome"
  },
  "data": {
    "trace_id": "a3f5b9c1-2d4e-4a5f-9b2c-7e8d9f1a2b3c",
    "link": "https://example.com/welcome"
  }
}
```

**Resilience**:
- Circuit breaker tracks FCM service health
- Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
- Jitter added to prevent thundering herd

**Retry conditions**:
- Network timeouts
- 5xx server errors
- Connection failures

**No retry on**:
- 4xx errors (invalid token, authentication failure)
- Circuit breaker open state

### 7. Handle Success
**Actions**:
1. Update Redis: `SET idempotency:{idempotency_key} "sent" EX 86400`
2. Write audit log to PostgreSQL
3. Acknowledge message in RabbitMQ

**Audit Log Entry**:
```sql
INSERT INTO audit_logs (
  trace_id,
  user_id,
  notification_type,
  template_id,
  status,
  metadata,
  created_at
) VALUES (
  'a3f5b9c1-2d4e-4a5f-9b2c-7e8d9f1a2b3c',
  '550e8400-e29b-41d4-a716-446655440000',
  'push',
  'welcome_notification',
  'sent',
  '{"campaign_id": "summer_2024"}',
  NOW()
);
```

### 8. Handle Failure
**After all retries exhausted**:

**Actions**:
1. Update Redis: `SET idempotency:{idempotency_key} "failed" EX 86400`
2. Write failure audit log to PostgreSQL
3. Publish message to Dead Letter Queue (`failed.queue`)
4. Acknowledge original message (prevents infinite requeue)

**DLQ Message Format**:
```json
{
  "original_message": { ... },
  "failure_reason": "FCM connection timeout after 3 retries",
  "failed_at": "2025-11-11T10:32:00Z"
}
```

## Circuit Breaker States

**Shared State**: Redis (allows coordination across multiple worker instances)

**Redis Keys**:
- `circuit:push_worker:fcm:state` → "closed" | "open" | "half_open"
- `circuit:push_worker:fcm:failures` → failure count
- `circuit:push_worker:template_service:state` → "closed" | "open" | "half_open"
- `circuit:push_worker:template_service:failures` → failure count

**Configuration**:
- Failure threshold: 5 consecutive failures
- Timeout: 30 seconds
- Success threshold to close: 2 consecutive successes

**Behavior**:
- **Closed**: Normal operation
- **Open**: Fail fast without calling external service, move messages to DLQ
- **Half-Open**: Allow 1 test request to check recovery

## Dependencies

**External Services**:
- RabbitMQ: Message consumption
- Redis: Idempotency tracking and circuit breaker state
- PostgreSQL: Audit logs
- Template Service: Template fetching (HTTP REST)
- Firebase Cloud Messaging: Push notification delivery (HTTP REST)

**Service Discovery**:
- Template Service URL from environment variable: `TEMPLATE_SERVICE_URL`

## Health Check

**Endpoint**: `GET /health`

**Checks**:
- PostgreSQL connection
- Redis connection
- RabbitMQ channel availability
- Circuit breaker states (non-critical)

**Response**:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-08T10:30:00Z",
  "checks": {
    "database": {"status": "healthy", "response_time_ms": 5},
    "cache_service": {"status": "healthy", "response_time_ms": 2},
    "message_broker": {"status": "healthy", "response_time_ms": 3},
    "fcm": {"status": "degraded", "circuit_breaker": "open"}
  }
}
```