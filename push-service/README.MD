# Push Service

A high-performance, production-ready push notification microservice built in Rust. Consumes messages from RabbitMQ, fetches and renders templates, sends notifications via Firebase Cloud Messaging (FCM), and maintains comprehensive audit logs.

## Project Structure

```
push-service/
├── src/
│   ├── main.rs              # Application entry point
│   ├── lib.rs               # Library exports
│   ├── api.rs               # Health check API
│   ├── config.rs            # Configuration management
│   ├── utils.rs             # Message processing logic
│   ├── clients/
│   │   ├── circuit_breaker.rs
│   │   ├── database.rs
│   │   ├── fcm.rs
│   │   ├── health.rs
│   │   ├── rbmq.rs
│   │   ├── redis.rs
│   │   └── template.rs
│   └── models/
│       ├── audit.rs
│       ├── circuit_breaker.rs
│       ├── fcm.rs
│       ├── health.rs
│       ├── message.rs
│       ├── retry.rs
│       ├── status.rs
│       └── template.rs
├── tests/
│   ├── e2e_tests.rs
│   ├── idempotency_tests.rs
│   ├── queue_tests.rs
│   └── retry_tests.rs
├── mock-services/
│   ├── template_service.py
│   ├── index.html
│   └── firebase-messaging-sw.js
├── Cargo.toml
├── Dockerfile
├── docker-compose.yml
├── schema.sql
├── .env.example
├── FLOW.md
└── README.md
```

## Key Features

- **Idempotency**: Prevents duplicate message processing using Redis-backed deduplication
- **Circuit Breakers**: Protects against cascading failures with Redis-shared state
- **Retry Logic**: Exponential backoff with jitter for transient failures
- **Dead Letter Queue**: Failed messages routed to DLQ with failure context
- **Audit Logging**: Complete notification lifecycle tracking in PostgreSQL
- **Graceful Degradation**: Continues operating when non-critical services are down
- **Health Checks**: Comprehensive health endpoint monitoring all dependencies
- **High Throughput**: Concurrent message processing with configurable worker limits

## Prerequisites

- **Rust**: 1.75+ (2024 edition)
- **Docker & Docker Compose**: For running infrastructure
- **Firebase Project**: With service account credentials
- **Template Service**: Running on port 8001 (or configure URL)

## Configuration

All configuration via environment variables. See `.env.example` for full list.

### Core Settings

| Variable                         | Description                  | Default                                                        |
| -------------------------------- | ---------------------------- | -------------------------------------------------------------- |
| `RABBITMQ_URL`                   | RabbitMQ connection string   | `amqp://guest:guest@localhost:5672/%2f`                        |
| `REDIS_URL`                      | Redis connection string      | `redis://localhost:6379/0`                                     |
| `DATABASE_URL`                   | PostgreSQL connection string | `postgres://postgres:postgres@localhost:5432/notifications_db` |
| `TEMPLATE_SERVICE_URL`           | Template service base URL    | `http://localhost:8001`                                        |
| `FCM_PROJECT_ID`                 | Firebase project ID          | _required_                                                     |
| `GOOGLE_APPLICATION_CREDENTIALS` | Path to service account JSON | `./service-account.json`                                       |

### Performance Tuning

| Variable                 | Description                       | Default |
| ------------------------ | --------------------------------- | ------- |
| `WORKER_CONCURRENCY`     | Max concurrent message processors | `4`     |
| `PREFETCH_COUNT`         | RabbitMQ prefetch count           | `10`    |
| `MAX_RETRY_ATTEMPTS`     | Max retry attempts per operation  | `5`     |
| `INITIAL_RETRY_DELAY_MS` | Initial retry delay               | `100`   |
| `MAX_RETRY_DELAY_MS`     | Max retry delay                   | `5000`  |

### Circuit Breaker Settings

| Variable                            | Description                       | Default |
| ----------------------------------- | --------------------------------- | ------- |
| `CIRCUIT_BREAKER_FAILURE_THRESHOLD` | Failures before opening circuit   | `5`     |
| `CIRCUIT_BREAKER_TIMEOUT_SECONDS`   | Circuit open duration             | `60`    |
| `CIRCUIT_BREAKER_SUCCESS_THRESHOLD` | Successes needed to close circuit | `3`     |

## Message Format

Send notification messages to the `push_notifications` queue:

```json
{
  "notification_id": "550e8400-e29b-41d4-a716-446655440000",
  "idempotency_key": "test_new_format_001",
  "notification_type": "push",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "template_code": "TEST_TEMPLATE",
  "variables": {
    "test_key": "Hello with new format"
  },
  "request_id": "req_test_new_format_001",
  "priority": 1,
  "metadata": {
    "push_token": "test_device_token_xyz"
  },
  "created_by": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2025-11-12T11:48:36.767Z"
}
```

## API Endpoints

### Health Check

```bash
GET http://localhost:8080/health
```

**Response**:

```json
{
  "success": true,
  "data": {
    "status": "degraded",
    "timestamp": "2025-11-12T13:01:34.029Z",
    "checks": {
      "database": {
        "status": "healthy",
        "response_time_ms": 98
      },
      "message_broker": {
        "status": "healthy",
        "response_time_ms": 59
      },
      "fcm": {
        "status": "degraded",
        "circuit_breaker": "open"
      },
      "cache_service": {
        "status": "healthy",
        "response_time_ms": 10
      },
      "template_service": {
        "status": "healthy",
        "response_time_ms": 0,
        "circuit_breaker": "closed"
      }
    }
  },
  "message": "Service degraded but operational"
}
```

**Status Values**:

- `healthy`: All systems operational
- `degraded`: Non-critical systems unavailable (e.g., circuit breakers open)
- `unhealthy`: Critical systems unavailable

## Quick Start

### 1. Clone Repository

```bash
git clone <repository-url>
cd push-service
```

### 2. Get Firebase Credentials

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project (or create one)
3. Navigate to **Project Settings** → **Service Accounts**
4. Click **Generate New Private Key**
5. Save the file as `service-account.json` in the project root
6. On the console, click the Settings icon (next to Project Overview). Choose Project settings.
7. Under Your apps, click 'Add app (Web)'. Enter a name for your app and register it. Firebase will generate a config object.
8. Paste these config fields into your `firebaseConfig` and `firebase.initializeApp` in `mock-services`.

```bash
# Verify the file
cat service-account.json | jq -r '.project_id'
# Should output your Firebase project ID
```

### 3. Configure Environment

```bash
cp docker-compose-example.yaml docker-cmpose.yaml
```

Edit `docker-cmpose.yaml` and set your Firebase project ID:

```bash
FCM_PROJECT_ID=your-actual-project-id-here
```

All other settings have sensible defaults for local development.

### 4. Start Everything

```bash
docker-compose up --build
```

This command:

- Starts RabbitMQ, Redis, PostgreSQL, and Template Service
- Initializes the database schema

### 5. Verify It's Working

In a new terminal:

```bash
# Check health
curl -s http://localhost:8080/health | jq '.'

# Should return:
# {
#   "status": "healthy",
#   "timestamp": "2025-11-11T...",
#   "checks": { ... }
# }
```

### 6. Send Your First Notification using RabbitMQ Management UI

1. Open http://localhost:15672 (guest/guest)
2. Go to **Queues** → **push_notifications** → **Publish message**
3. Paste this payload:

```json
{
  "trace_id": "test_001",
  "idempotency_key": "unique_key_001",
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "notification_type": "push",
  "recipient": "your_fcm_device_token",
  "template_code": "TEST_TEMPLATE",
  "variables": {
    "test_key": "Hello World!"
  },
  "language": "en",
  "metadata": {}
}
```

4. Click **Publish message**

## Get a Real FCM Device Token

To test with actual push notifications, you need a device token:

### Option 1: Use Mock HTML Page

Open http://localhost:8002 in your browser:

1. Click "Request Notification Permission"
2. Accept the browser prompt
3. Copy the token displayed

### Option 2: Use Your Mobile App

If you have an app with FCM:

1. Log the FCM token in your app
2. Copy it to use in test messages

## Monitor Activity

### View Logs

```bash
docker-compose logs -f
```

### Check Queue Status

```bash
# RabbitMQ Management UI
open http://localhost:15672

# Or via CLI
docker exec push-service-rabbitmq rabbitmqctl list_queues
```

## Running Tests

```bash
# Start test infrastructure
docker-compose up -d

# Run all tests
cargo test

# Run specific test suites
cargo test --test idempotency_tests
cargo test --test queue_tests
cargo test --test retry_tests
cargo test --test e2e_tests
```

## Code Quality

```bash
# Format code
cargo fmt

# Run linter
cargo clippy --all-targets --all-features -- -D warnings

# Security audit
cargo audit
```
