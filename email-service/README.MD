
# Email Service - Distributed Notification System

A microservice for processing email notifications using NestJS, RabbitMQ, and SMTP.

## Features

- ✅ **Asynchronous Processing**: Consumes messages from RabbitMQ email queue
- ✅ **Circuit Breaker**: Prevents cascading failures when SMTP is down
- ✅ **Retry Mechanism**: Exponential backoff with dead-letter queue
- ✅ **Idempotency**: Prevents duplicate email sends
- ✅ **Template Rendering**: Fetches and renders email templates with variables
- ✅ **Status Updates**: Reports delivery status to API Gateway
- ✅ **Health Checks**: `/health` endpoint for monitoring
- ✅ **Docker Support**: Containerized with Docker Compose
- ✅ **CI/CD Pipeline**: GitHub Actions workflow

## Architecture

```
Client → API Gateway → RabbitMQ (email.queue) → Email Service → SMTP Provider
                                                      ↓
                                              Template Service
                                                      ↓
                                               Status Update
```

## Prerequisites

- Node.js 18+
- RabbitMQ 3.12+
- SMTP Server (Gmail, SendGrid, Mailgun, etc.)
- Docker & Docker Compose (optional)

## Installation

### Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
nano .env

# Start RabbitMQ (if not running)
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3.12-management-alpine

# Run the service
npm run start:dev
```

### Using Docker

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f email-service

# Stop services
docker-compose down
```

## Configuration

### SMTP Setup (Gmail Example)

1. Enable 2-factor authentication in your Gmail account
2. Generate an App Password: Account Settings → Security → App Passwords
3. Add to `.env`:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-16-char-app-password
SMTP_FROM=your-email@gmail.com
```

### Alternative SMTP Providers

**SendGrid:**
```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
```

**Mailgun:**
```env
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_USER=postmaster@your-domain.com
SMTP_PASSWORD=your-mailgun-password
```

## Message Format

The service expects messages in this format from RabbitMQ:

```json
{
  "notification_id": "notif_123",
  "user_id": "user_456",
  "template_code": "welcome_email",
  "variables": {
    "name": "John Doe",
    "link": "https://example.com/verify",
    "subject": "Welcome to Our Platform"
  },
  "request_id": "req_789",
  "priority": 1,
  "to_email": "user@example.com",
  "metadata": {}
}
```

## API Endpoints

### Health Check
```bash
GET /health
```

Response:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "service": "email-service",
    "timestamp": "2025-11-11T10:00:00.000Z",
    "circuit_breaker": {
      "state": "CLOSED",
      "failure_count": 0,
      "success_count": 0
    },
    "uptime": 3600,
    "memory": {...}
  },
  "message": "Service is healthy"
}
```

## Circuit Breaker

The circuit breaker protects against SMTP failures:

- **CLOSED**: Normal operation
- **OPEN**: Too many failures (5+), stops sending for 60s
- **HALF_OPEN**: Testing if service recovered

## Retry Logic

Failed messages are retried with exponential backoff:

1. **1st retry**: 2 seconds delay
2. **2nd retry**: 4 seconds delay
3. **3rd retry**: 8 seconds delay
4. **After 3 retries**: Message sent to dead-letter queue

## Monitoring

### Key Metrics to Track

- Message processing rate
- Email delivery success rate
- Circuit breaker state
- Queue length
- Processing time per email
- Error rate

### Logs

All logs include correlation IDs for tracing:

```
[EmailProcessor] Processing email notification: notif_123
[EmailService] Email sent successfully to user@example.com: <message-id>
[StatusService] Status updated for notif_123: delivered
```

## Testing

### Manual Testing

Send a test message to RabbitMQ:

```bash
# Install RabbitMQ admin tools
npm install -g amqplib

# Or use RabbitMQ Management UI at http://localhost:15672
# Default credentials: admin/admin
```

### Unit Tests

```bash
npm run test
npm run test:watch
npm run test:cov
```

## Deployment

### GitHub Actions

The CI/CD pipeline automatically:

1. Runs tests on push/PR
2. Builds Docker image
3. Pushes to GitHub Container Registry
4. Deploys to server via SSH (on main branch)

### Required Secrets

Configure in GitHub Settings → Secrets:

- `SERVER_HOST`: Your deployment server IP
- `SERVER_USER`: SSH username
- `SSH_PRIVATE_KEY`: SSH private key
- `SLACK_WEBHOOK`: (Optional) For deployment notifications

### Manual Deployment

```bash
# Build Docker image
docker build -t email-service:latest .

# Tag and push
docker tag email-service:latest your-registry/email-service:latest
docker push your-registry/email-service:latest

# Deploy on server
ssh user@server
cd /opt/notification-system
docker-compose pull email-service
docker-compose up -d email-service
```

## Troubleshooting

### Service Not Consuming Messages

```bash
# Check RabbitMQ connection
docker-compose logs email-service | grep RabbitMQ

# Check queue status
curl http://localhost:15672/api/queues
```

### SMTP Connection Issues

```bash
# Test SMTP connection
npm run start:dev
# Check logs for "SMTP server ready" message

# Test with telnet
telnet smtp.gmail.com 587
```

### Circuit Breaker Stuck Open

```bash
# Check circuit breaker status
curl http://localhost:3002/api/v1/health

# Restart service to reset
docker-compose restart email-service
```

## Performance Optimization

- **Prefetch**: Set to 10 (adjust based on server capacity)
- **Template Caching**: Templates cached in memory
- **Connection Pooling**: SMTP transporter reuses connections
- **Horizontal Scaling**: Run multiple instances behind a load balancer

## Contributing

1. Create feature branch
2. Make changes
3. Run tests: `npm run test`
4. Submit pull request

## License

MIT