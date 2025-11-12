# Testing Guide - Template Service

Complete step-by-step testing process for the Template Service.

## Prerequisites

- Docker & Docker Compose installed
- Node.js 18+ (for local testing)
- Port 8084, 5433, 6380, 5673, 15673 available

---

## Test Process

### Step 1: Environment Setup

```bash
# Navigate to template-service directory
cd c:\Users\Hp\distributed-notification-system\template-service

# Copy environment file
cp .env.example .env

# Verify .env contains correct values
cat .env
```

**Expected `.env` content:**

```
PORT=8084
DATABASE_HOST=postgres
DATABASE_USER=postgres
DATABASE_PASSWORD=password
DATABASE_NAME=template_db
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
```

---

### Step 2: Start Services

```bash
# Start all containers
docker-compose up --build -d

# Wait 60 seconds for services to initialize
timeout /t 60  # Windows
# sleep 60     # Linux/Mac

# Check container status
docker-compose ps
```

**Expected output:**

```
NAME                          STATUS
template-service              running (healthy)
template-service-postgres     running (healthy)
template-service-redis        running (healthy)
template-service-rabbitmq     running (healthy)
```

---

### Step 3: Health Check Test

```bash
# Test health endpoint
curl http://localhost:8084/health
```

**Expected response:**

```json
{
  "status": "healthy",
  "service": "template-service",
  "timestamp": "2025-...",
  "uptime": 120,
  "checks": {
    "database": {
      "status": "healthy",
      "latency": 8,
      "circuitBreaker": { "state": "CLOSED", "failures": 0 }
    },
    "redis": {
      "status": "healthy",
      "latency": 2,
      "circuitBreaker": { "state": "CLOSED", "failures": 0 }
    },
    "rabbitmq": {
      "status": "healthy",
      "circuitBreaker": { "state": "CLOSED", "failures": 0 }
    }
  }
}
```

**Pass Criteria:** All services show `"status": "healthy"`

---

### Step 4: Swagger Documentation Test

```bash
# Open Swagger UI in browser
start http://localhost:8084/api/docs  # Windows
# open http://localhost:8084/api/docs  # Mac
```

**Expected:**

- Swagger UI loads
- "Templates" and "Health" tags visible
- All endpoints documented

---

### Step 5: Create Template Test

**Using Swagger:**

1. Open http://localhost:8084/api/docs
2. Click **POST /api/v1/templates**
3. Click **"Try it out"**
4. Use this payload:

```json
{
  "code": "welcome_email",
  "type": "email",
  "language": "en",
  "content": {
    "subject": "Welcome {{name}}!",
    "body": "Hi {{name}}, welcome to our service."
  },
  "variables": ["name"]
}
```

5. Click **Execute**

**Expected response (201):**

```json
{
  "id": "uuid-here",
  "code": "welcome_email",
  "type": "email",
  "language": "en",
  "version": 1,
  "content": {
    "subject": "Welcome {{name}}!",
    "body": "Hi {{name}}, welcome to our service."
  },
  "variables": ["name"],
  "created_at": "2025-...",
  "updated_at": "2025-..."
}
```

**Pass Criteria:** Status 201, `version` is 1

---

### Step 6: Cache Test (First GET - Cache Hit)

**Using Swagger:**

1. Click **GET /api/v1/templates/{code}**
2. Enter `welcome_email` as code
3. Enter `en` as lang (query param)
4. Click **Execute**

**Check logs:**

```bash
docker-compose logs -f template-service | findstr CACHE
```

**Expected log:**

```
[CACHE_HIT] template:welcome_email:en:latest (latency: 2ms)
```

**Note:** Cache was set during CREATE, so first GET is a HIT!

---

### Step 7: Cache Test (Subsequent GETs - Cache Hits)

**Repeat GET request 3 times via Swagger**

**Expected logs:**

```
[CACHE_HIT] template:welcome_email:en:latest (latency: 1ms)
[CACHE_HIT] template:welcome_email:en:latest (latency: 1ms)
[CACHE_HIT] template:welcome_email:en:latest (latency: 1ms)
```

**Pass Criteria:** All requests show `CACHE_HIT` with ~1-2ms latency

---

### Step 8: Update Template Test (Versioning)

**Using Swagger:**

1. Click **PUT /api/v1/templates/{code}**
2. Enter `welcome_email` as code
3. Use this payload:

```json
{
  "language": "en",
  "content": {
    "subject": "Welcome {{name}}!",
    "body": "Hello {{name}}, thanks for joining us!"
  }
}
```

4. Click **Execute**

**Expected response (200):**

```json
{
  "id": "new-uuid",
  "code": "welcome_email",
  "type": "email",
  "language": "en",
  "version": 2,
  "content": {
    "subject": "Welcome {{name}}!",
    "body": "Hello {{name}}, thanks for joining us!"
  },
  "variables": ["name"],
  "created_at": "2025-...",
  "updated_at": "2025-..."
}
```

**Pass Criteria:** `version` is now 2

---

### Step 9: Cache Invalidation Test

**Check logs after UPDATE:**

```bash
docker-compose logs template-service | findstr CACHE_INVALIDATE
```

**Expected:**

```
[CACHE_INVALIDATE] Deleted 2 cache key(s) for: welcome_email (language: en)
[CACHE_SET] welcome_email v2 (language: en, TTL: 3600s)
```

**Pass Criteria:** Old cache deleted, new version cached

---

### Step 10: Event Publishing Test

**Check RabbitMQ logs:**

```bash
docker-compose logs template-service | findstr "Published template.updated"
```

**Expected:**

```
Published template.updated event: code=welcome_email, version=1
Published template.updated event: code=welcome_email, version=2
```

**Verify in RabbitMQ UI:**

1. Open http://localhost:15673
2. Login: `guest` / `guest`
3. Click **Exchanges** tab
4. Find `notifications.direct` exchange
5. Verify: Type = `direct`, Durable = `true`

**Pass Criteria:** Exchange exists, events published

---

### Step 11: List Templates Test

**Using Swagger:**

1. Click **GET /api/v1/templates**
2. Enter `page=1`, `limit=10`
3. Click **Execute**

**Expected response:**

```json
{
  "data": [
    { "code": "welcome_email", "version": 2, "..." }
  ],
  "meta": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "totalPages": 1
  }
}
```

**Pass Criteria:** Template appears in list

---

### Step 12: Variable Validation Test

**Using Swagger (should FAIL):**

1. Click **POST /api/v1/templates**
2. Use this invalid payload:

```json
{
  "code": "invalid_test",
  "type": "email",
  "language": "en",
  "content": {
    "body": "Hello {{name}}, your code is {{code}}"
  },
  "variables": ["name"]
}
```

3. Click **Execute**

**Expected response (400):**

```json
{
  "statusCode": 400,
  "message": "Variable validation failed: Missing variables [code] found in content placeholders",
  "timestamp": "2025-..."
}
```

**Pass Criteria:** Request fails with validation error

---

### Step 13: Circuit Breaker Test

```bash
# Stop PostgreSQL
docker-compose stop postgres

# Trigger 5 health checks to open circuit
for /L %i in (1,1,5) do curl http://localhost:8084/health & timeout /t 1

# Check health again
curl http://localhost:8084/health
```

**Expected:**

```json
{
  "status": "down",
  "checks": {
    "database": {
      "status": "down",
      "circuitBreaker": {
        "state": "OPEN",
        "failures": 5
      }
    }
  }
}
```

```bash
# Restart PostgreSQL
docker-compose start postgres

# Wait 30 seconds
timeout /t 30

# Check health (should recover)
curl http://localhost:8084/health
```

**Pass Criteria:** Circuit opens after 5 failures, closes after recovery

---

### Step 14: Automated Tests

```bash
# Run unit tests
npm test

# Expected output:
# PASS  src/modules/templates/utils/extract-placeholders.util.spec.ts
# PASS  src/test/integration/template-api.integration.spec.ts
# PASS  src/test/e2e/app.e2e.spec.ts
# Test Suites: 3 passed
# Tests: 16 passed
```

 **Pass Criteria:** All tests pass

---

## Test Summary Checklist

| Test                  | Status | Notes                    |
| --------------------- | ------ | ------------------------ |
| ☐ Services start      |        | All containers healthy   |
| ☐ Health endpoint     |        | All checks green         |
| ☐ Swagger loads       |        | Documentation accessible |
| ☐ Create template     |        | Version 1 created        |
| ☐ Cache hit           |        | Fast response (~1ms)     |
| ☐ Update template     |        | Version 2 created        |
| ☐ Cache invalidation  |        | Old cache deleted        |
| ☐ Event publishing    |        | RabbitMQ events sent     |
| ☐ List templates      |        | Pagination works         |
| ☐ Variable validation |        | Invalid input rejected   |
| ☐ Circuit breaker     |        | Opens/closes correctly   |
| ☐ Automated tests     |        | All pass                 |

---

## Cleanup

```bash
# Stop all services
docker-compose down

# Remove volumes (fresh start)
docker-compose down -v
```

---

## Troubleshooting

**Service won't start:**

- Check logs: `docker-compose logs template-service`
- Verify ports: `netstat -ano | findstr 8084`

**Health check fails:**

- Wait longer (services need ~60s to start)
- Check individual services: `docker-compose ps`

**Tests fail:**

- Clear cache: `npx jest --clearCache`
- Reinstall: `rm -rf node_modules && npm install`

---

## Next Steps

After all tests pass:

1. Push to `feat/template-service` branch
2. Create PR to `develop`
3. CI/CD pipeline will run automatically
4. Review and merge after all checks pass

**CI/CD Pipeline URL:**

```
https://github.com/<your-username>/distributed-notification-system/actions
```
