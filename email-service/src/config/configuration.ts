import * as dotenv from 'dotenv';

dotenv.config();

export default () => ({
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // RabbitMQ Configuration
  rabbitmq: {
    url: process.env.RABBITMQ_URL || 'amqp://localhost:5672',
  },

  // Redis Configuration
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    templateCacheTtl: parseInt(process.env.TEMPLATE_CACHE_TTL || '3600', 10),
    userPrefsCacheTtl: parseInt(process.env.USER_PREFS_CACHE_TTL || '1800', 10),
    idempotencyTtl: parseInt(process.env.IDEMPOTENCY_TTL || '86400', 10),
  },

  // SMTP Configuration
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.sendgrid.net',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || 'apikey',
      pass: process.env.SMTP_PASSWORD,
    },
    from: process.env.SMTP_FROM || 'notifications@example.com',
  },

  // Service URLs
  services: {
    apiGateway: process.env.API_GATEWAY_URL || 'http://localhost:3000',
    user: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    template: process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3002',
  },

  // Rate Limiting
  rateLimit: {
    window: parseInt(process.env.RATE_LIMIT_WINDOW || '60', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
});
