# Template Service

Microservice for managing reusable notification templates with versioning, caching, and event publishing.

## Quick Start

```bash
# 1. Copy environment file
cp .env.example .env

# 2. Start all services
docker-compose up --build -d

# 3. Check health
curl http://localhost:8084/health

# 4. Access Swagger
open http://localhost:8084/api/docs
```

## Access Points

- **Template Service**: http://localhost:8084
- **Swagger Docs**: http://localhost:8084/api/docs
- **PostgreSQL**: localhost:5433
- **Redis**: localhost:6380
- **RabbitMQ UI**: http://localhost:15673 (guest/guest)

## Environment Configuration

### Docker (.env)
```bash
PORT=8084
DATABASE_HOST=postgres
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=password
DATABASE_NAME=template_db
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
```

### Local Development (.env)
```bash
PORT=8084
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USER=postgres
DATABASE_PASSWORD=password
DATABASE_NAME=template_db
REDIS_URL=redis://localhost:6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
```

**Never commit `.env` files!**

## Features

**Template CRUD** - Create, read, update, delete with versioning  
**Caching** - Redis-backed caching with automatic invalidation  
**Event Publishing** - RabbitMQ events on template changes  
**Circuit Breaker** - Automatic failure detection and recovery  
**Health Checks** - Comprehensive health monitoring  
**Swagger Docs** - Interactive API documentation  
**CI/CD** - GitHub Actions pipeline  
**Docker Ready** - Production-ready containerization  

## Development Commands

| Command | Description |
|---------|-------------|
| `docker-compose up --build -d` | Start all services |
| `docker-compose down` | Stop all services |
| `docker-compose logs -f template-service` | View logs |
| `docker-compose ps` | Check status |
| `npm run start:dev` | Run locally (without Docker) |
| `npm run lint` | Run linter |
| `npm run build` | Build TypeScript |
| `npm test` | Run tests |

## Migrations

```bash
# Generate new migration
npm run migration:generate src/migrations/MigrationName

# Run migrations
npm run migration:run

# Revert last migration
npm run migration:revert
```

**Note:** Migrations run automatically in Docker on startup.

## Architecture

### Tech Stack
- **Framework**: NestJS + TypeScript (strict mode)
- **Database**: PostgreSQL 16
- **Cache**: Redis 7
- **Messaging**: RabbitMQ 3
- **API Docs**: Swagger/OpenAPI
- **Testing**: Jest

### Key Components
- **Templates Module** - CRUD with versioning
- **Redis Service** - Typed caching layer
- **RabbitMQ Service** - Event publishing
- **Circuit Breaker** - Failure protection
- **Health Controller** - Service monitoring

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/api/docs` | Swagger documentation |
| POST | `/api/v1/templates` | Create template (v1) |
| PUT | `/api/v1/templates/:code` | Update template (new version) |
| GET | `/api/v1/templates/:code` | Get template (latest or specific version) |
| GET | `/api/v1/templates` | List templates (paginated) |
| DELETE | `/api/v1/templates/:code` | Delete template |

## Testing

See [TESTING.md](./TESTING.md) for complete testing guide.

```bash
# Run all tests
npm test

# Run with coverage
npm run test:cov

# Run integration tests
npm test -- --testPathPattern=integration

# Run E2E tests
npm test -- --testPathPattern=e2e
```

## CI/CD

Pipeline runs on push to `main`, `develop`, or `feat/**` branches.

**Checks:**
- Linting (no `any` types allowed)
- TypeScript build
- Database migrations
- Unit + Integration tests
- Docker image build
- Security audit

## Production Deployment

```bash
# Build production image
docker build -t template-service:latest .

# Run in production
docker-compose -f docker-compose.prod.yml up -d
```

**Security Best Practices:**
- Non-root user (UID 1001)
- Health checks enabled
- Resource limits configured
- Secrets managed via environment variables
- Manual migrations only (no auto-sync)

## Troubleshooting

**Service won't start:**
```bash
docker-compose logs template-service
docker-compose ps
```

**Database issues:**
```bash
docker exec template-service-postgres psql -U postgres -c "SELECT 1"
```

**Redis issues:**
```bash
docker exec template-service-redis redis-cli ping
```

**RabbitMQ issues:**
```bash
docker exec template-service-rabbitmq rabbitmq-diagnostics ping
```

**Clean slate:**
```bash
docker-compose down -v
docker-compose up --build -d
```

## Documentation

- [Testing Guide](./TESTING.md) - Complete testing documentation
- [CI/CD Pipeline](./.github/workflows/README.md) - GitHub Actions setup
- [API Documentation](http://localhost:8084/api/docs) - Interactive Swagger docs

## License

Private - Internal use only
