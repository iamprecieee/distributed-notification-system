# Template Service Flow

## Overview
The Template Service provides and manages reusable templates for all notification types (email and push).  
It stores, versions, and caches templates but does not perform variable rendering because rendering is handled inside worker services (Email / Push) for scalability and fault isolation.

---

## Complete Flow

### 1. Incoming request
Sources:
- Email Service or Push Service (runtime template fetch)
- API Gateway or Admin Panel (template creation and update)

Common endpoints:
| Operation | Method | Example |
|-----------|--------|---------|
| Fetch template | GET | `GET /api/v1/templates/{code}?version=latest&lang=en` |
| Create template | POST | `POST /api/v1/templates` (admin only) |
| Update template | PUT | `PUT /api/v1/templates/{code}` (admin only) |
| List templates | GET | `GET /api/v1/templates` (admin / internal) |

Example fetch request:
```http
GET http://template-service:8084/api/v1/templates/welcome_notification?lang=en
```

Example response:
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

---

### 2. Cache lookup
Action: Check Redis before querying PostgreSQL.

Redis key pattern:
```text
template:{code}:{language}:{version}
```

Logic:
- Cache hit → return immediately (~1–2 ms)  
- Cache miss → query DB → store in cache  
- TTL = 3600 seconds (1 hour)

Benefit: reduces DB load and keeps latency low (< 10 ms) for frequently used templates.

---

### 3. Database fetch (fallback)
Action: query PostgreSQL `templates` table for `{code, language}` ordered by `version DESC`. If `version=latest` → return the first row.

Schema excerpt:
```sql
CREATE TABLE templates (
  id uuid PRIMARY KEY,
  code text,
  type text,
  language text,
  version int,
  content jsonb,
  variables jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
```

Resilience:
- Circuit breaker protects DB driver.  
- On DB failure → return cached version if available, otherwise respond 503.

---

### 4. Version resolution
Action: determine the correct version to serve.
- If `version` query param is present → return that exact version.
- Else → return the latest active version.

Rule: updates never overwrite old versions; each change inserts a new record with `version = previous + 1`.

---

### 5. Variable validation
Action: ensure placeholders in `content` match the declared `variables` array on create/update. Workers expect a valid, render-ready template.

Example:
Template: `Hi {{name}}, visit {{link}}`  
Variables: `["name", "link"]`

If a variable is missing, reject creation/update:
```json
{ "error": "Variable mismatch: missing 'link'" }
```

---

### 6. Worker-side rendering (external process)
Action (in workers):
1. Worker fetches the template JSON.
2. Performs variable substitution locally using a templating engine (Handlebars, Mustache, etc.).
3. Sends the final message through SMTP / FCM / Web Push.

Example (Email Worker):
```ts
const template = await getTemplate("welcome_notification", 2);
const compiled = Handlebars.compile(template.content.body);
const rendered = compiled({ name: "Big Lens", link: "https://example.com" });
```

Benefit:
- Keeps Template Service lightweight.
- Allows workers to scale independently.
- Workers can continue if Template Service is briefly unavailable (via cached templates).

---

### 7. Cache write-back
After DB fetch:
```text
SET template:{code}:{language}:{version} <json> EX 3600
```
When a template is updated, publish a `template.updated` event through RabbitMQ so other services can invalidate their caches.

---

### 8. Audit logging
Record each CRUD action for traceability.

Example:
```sql
INSERT INTO template_audit
(trace_id, code, version, action, actor, timestamp)
VALUES
('uuid', 'welcome_notification', 2, 'fetch', 'push_service', NOW());
```

---

### 9. Circuit breaker & retry policy
Shared keys in Redis:
```text
circuit:template_service:db:state
circuit:template_service:redis:state
```

Configuration:
- 5 consecutive failures → open for 30s  
- While open → serve cached data or fail fast  
- 2 consecutive successes → close breaker

---

### 10. Health check
Endpoint:
```http
GET /health
```

Checks:
- PostgreSQL connectivity
- Redis latency
- Cache hit ratio
- Circuit-breaker state

Example response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-11T18:00:00Z",
  "checks": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" },
    "cache_hit_ratio": 0.93
  }
}
```

## Summary flow
```
Worker (Email or Push)
        │
        ▼
HTTP GET /api/v1/templates/{code}?lang=en
        │
        ▼
Template Service
  ├─ Check Redis (cache hit → return)
  ├─ Fetch from Postgres (if miss)
  ├─ Resolve version
  ├─ Validate placeholders (on create/update)
  ├─ Cache result + publish update
  └─ Return JSON template
        │
        ▼
Worker renders and sends notification
```
---