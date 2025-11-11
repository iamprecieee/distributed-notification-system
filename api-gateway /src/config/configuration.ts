import * as dotenv from 'dotenv';

dotenv.config();

export default () => ({
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',
  apiPrefix: process.env.API_PREFIX || 'api',

  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production',
    expiresIn: process.env.JWT_EXPIRATION || '24h',
  },

  services: {
    user: {
      url: process.env.USER_SERVICE_URL || 'http://localhost:3001',
      timeout: parseInt(process.env.HTTP_TIMEOUT, 10) || 5000,
    },
    template: {
      url: process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3002',
      timeout: parseInt(process.env.HTTP_TIMEOUT, 10) || 5000,
    },
  },

  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
    queuePrefix: process.env.RABBITMQ_QUEUE_PREFIX || 'notifications',
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    // password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
  },

  rateLimit: {
    ttl: parseInt(process.env.RATE_LIMIT_TTL, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  circuitBreaker: {
    timeout: parseInt(process.env.CIRCUIT_BREAKER_TIMEOUT, 10) || 10000,
    errorThreshold: parseInt(process.env.CIRCUIT_BREAKER_THRESHOLD, 10) || 5,
    resetTimeout:
      parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT, 10) || 30000,
  },
});
