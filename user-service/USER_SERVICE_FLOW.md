# User Service Flow

## Overview
REST API microservice managing user data, authentication, and notification preferences.

## Database Schema

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  push_token VARCHAR(255),
  password_hash VARCHAR(255) NOT NULL,
  preferences JSONB DEFAULT '{"email":true,"push":true}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
```

## API Endpoints

### 1. Create User
`POST /api/v1/users/create`

**Request:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "push_token": "fcm_token",
  "preferences": {"email": true, "push": true}
}
```

**Flow:**
1. Validate input (email format, password min 8 chars)
2. Check duplicate email → `409 Conflict` if exists
3. Hash password with bcrypt (salt rounds = 10)
4. Insert into database
5. Cache preferences in Redis (`user:preferences:{id}`, TTL: 1h)

**Response:** `201 Created` with user data (excluding password_hash)

---

### 2. Login
`POST /api/v1/auth/login`

**Request:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Flow:**
1. Find user by email
2. Verify password with bcrypt → `401 Unauthorized` if invalid
3. Generate JWT access token (HS256, 24h expiry)
4. Generate refresh token (UUID, stored in database/Redis with 7 day expiry)
5. Return tokens and user info

**Response:** `200 OK`
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "uuid-refresh-token",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

---

### 3. Refresh Token
`POST /api/v1/auth/refresh`

**Request:**
```json
{
  "refresh_token": "uuid-refresh-token"
}
```

**Flow:**
1. Validate refresh token exists and not expired
2. Verify refresh token in database/Redis
3. Generate new JWT access token (24h expiry)
4. Optionally rotate refresh token
5. Return new tokens

**Response:** `200 OK`
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "new-uuid-refresh-token",
  "token_type": "Bearer",
  "expires_in": 86400,
  "user": {
    "id": "user_id",
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

---

### 4. Logout
`POST /api/v1/auth/logout`

**Request:**
```json
{
  "refresh_token": "uuid-refresh-token"
}
```

**Flow:**
1. Verify JWT from Authorization header
2. Remove refresh token from database/Redis
3. Optionally blacklist access token (if implementing token revocation)
4. Return success response

**Response:** `200 OK`
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

---

### 5. Validate Token
`POST /api/v1/auth/validate`

**Request:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Flow:**
1. Verify JWT signature
2. Check token expiration
3. Optionally check token blacklist
4. Extract user information from payload
5. Return validation result

**Response:** `200 OK`
```json
{
  "valid": true,
  "user_id": "user_id",
  "email": "john@example.com",
  "push_token": "fcm_token",
  "expires_at": 1699790400
}
```

**Invalid Response:** `200 OK`
```json
{
  "valid": false,
  "reason": "Token expired"
}
```

---

### 6. Get Preferences (High-Frequency)
`GET /api/v1/users/{id}/preferences`

**Flow:**
1. Verify JWT → `401 Unauthorized` if invalid
2. Check Redis cache → Return if hit (~2ms)
3. Query database if cache miss (~20-50ms)
4. Cache result and return

**Response:** `200 OK` with preferences object

---

### 7. Update User
`PATCH /api/v1/users/{id}`

**Request:** (all optional)
```json
{
  "name": "John Smith",
  "push_token": "new_token",
  "preferences": {"email": false, "push": true}
}
```

**Flow:**
1. Verify JWT and ownership → `403 Forbidden` if mismatch
2. Update provided fields only
3. Invalidate and re-cache preferences

**Response:** `200 OK` with updated user data

---

### 8. Get User by ID
`GET /api/v1/users/{id}`

Query database and return user data (excluding password_hash).

**Response:** `200 OK` or `404 Not Found`

---

### 9. List Users
`GET /api/v1/users?page=1&limit=10`

Paginated list with default limit=10, max=100.

**Response:** `200 OK` with users array and pagination meta

---

### 10. Delete User
`DELETE /api/v1/users/{id}`

**Flow:**
1. Verify JWT and ownership/admin role
2. Delete from database
3. Invalidate all user caches
4. Remove all refresh tokens

**Response:** `200 OK`

---

## Caching (Redis)

**Keys:**
- `user:preferences:{id}` - TTL: 3600s
- `refresh_token:{token}` - TTL: 604800s (7 days)
- `token_blacklist:{token}` - TTL: varies (optional)

**Invalidation:**
- On user update/delete
- On logout (refresh tokens)

---

## Authentication

**JWT Access Token Payload:**
```json
{
  "sub": "user_id",
  "email": "user@example.com",
  "name": "User Name",
  "exp": 1699790400
}
```

**JWT Config:**
- Algorithm: HS256
- Expiration: 24h
- Secret: `JWT_SECRET` env var

**Refresh Token:**
- Format: UUID v4
- Storage: Redis/Database
- Expiration: 7 days
- One-time use (rotate on refresh)

**Protected Endpoints:** All except `/auth/login`, `POST /users/create`, and `/auth/validate`

---

## Health Check
`GET /health`

Returns status of database and Redis connections.

**Response:** `200 OK` or `503 Service Unavailable`

`GET /health/test-redis`

Returns status of Redis connections.

**Response:** `200 OK` or `503 Service Unavailable`

---

## Standard Response Format

**Success:**
```json
{
  "success": true,
  "message": "Operation successful",
  "data": {...},
  "meta": {
    "total": 100,
    "page": 1,
    "limit": 10,
    "total_pages": 10,
    "has_next": true,
    "has_previous": false
  }
}
```

**Error:**
```json
{
  "success": false,
  "error": "Error message",
  "message": "Request failed",
  "meta": {...}
}
```

---

## Status Codes

- `200` OK
- `201` Created
- `400` Bad Request
- `401` Unauthorized
- `403` Forbidden
- `404` Not Found
- `409` Conflict
- `500` Internal Server Error
- `503` Service Unavailable

---

## Logging

**Format:**
```json
{
  "level": "info",
  "time": "2025-11-11T10:00:00Z",
  "service": "user-service",
  "method": "POST",
  "url": "/api/v1/users",
  "statusCode": 201,
  "responseTime": 45,
  "msg": "User created"
}
```

**Levels:** `info`, `warn`, `error`, `debug`