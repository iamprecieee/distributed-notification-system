import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect() {
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        this.client = createClient({
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                this.logger.error('Max Redis reconnection attempts reached');
                return new Error('Max reconnection attempts reached');
              }
              return Math.min(retries * 100, 3000);
            },
          },
        });

        this.client.on('error', (err) => {
          this.logger.error('Redis Client Error', err);
        });

        this.client.on('connect', () => {
          this.logger.log('Redis client connected');
        });

        this.client.on('ready', () => {
          this.logger.log('Redis client ready');
        });

        this.client.on('reconnecting', () => {
          this.logger.warn('Redis client reconnecting');
        });

        await this.client.connect();
        this.logger.log('Successfully connected to Redis');
        return;
      } catch (error) {
        retries++;
        this.logger.error(
          `Failed to connect to Redis (attempt ${retries}/${maxRetries})`,
          error,
        );
        if (retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    throw new Error('Could not connect to Redis after multiple attempts');
  }

  private async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  // Set a value with optional TTL
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, serialized);
      } else {
        await this.client.set(key, serialized);
      }
    } catch (error) {
      this.logger.error(`Failed to set key: ${key}`, error);
      throw error;
    }
  }

  // Get a value by key
  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error(`Failed to get key: ${key}`, error);
      return null;
    }
  }

  // Delete a key
  async delete(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error(`Failed to delete key: ${key}`, error);
      throw error;
    }
  }

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to check existence of key: ${key}`, error);
      return false;
    }
  }

  // Set expiration on a key
  async expire(key: string, seconds: number): Promise<void> {
    try {
      await this.client.expire(key, seconds);
    } catch (error) {
      this.logger.error(`Failed to set expiration on key: ${key}`, error);
      throw error;
    }
  }

  // Check and mark request as processed (idempotency)
  async checkAndMarkProcessed(
    requestId: string,
    ttlSeconds: number = 86400,
  ): Promise<boolean> {
    const key = `idempotency:${requestId}`;
    try {
      const exists = await this.exists(key);
      if (exists) {
        this.logger.warn(`Duplicate request detected: ${requestId}`);
        return true;
      }

      await this.set(
        key,
        { processed_at: new Date().toISOString() },
        ttlSeconds,
      );
      return false;
    } catch (error) {
      this.logger.error(`Idempotency check failed for: ${requestId}`, error);
      return false;
    }
  }

  // Clear idempotency record (use with caution)
  async clearIdempotency(requestId: string): Promise<void> {
    const key = `idempotency:${requestId}`;
    await this.delete(key);
  }

  // Increment rate limit counter
  async incrementRateLimit(
    identifier: string,
    windowSeconds: number = 60,
  ): Promise<number> {
    const key = `rate_limit:${identifier}`;
    try {
      const count = await this.client.incr(key);

      if (count === 1) {
        await this.expire(key, windowSeconds);
      }

      return count;
    } catch (error) {
      this.logger.error(
        `Rate limit increment failed for: ${identifier}`,
        error,
      );
      return 0;
    }
  }

  // Check if rate limit exceeded
  async isRateLimitExceeded(
    identifier: string,
    maxRequests: number,
    windowSeconds: number = 60,
  ): Promise<boolean> {
    const count = await this.incrementRateLimit(identifier, windowSeconds);
    return count > maxRequests;
  }

  // Get remaining rate limit quota
  async getRateLimitRemaining(
    identifier: string,
    maxRequests: number,
  ): Promise<number> {
    const key = `rate_limit:${identifier}`;
    try {
      const countStr = await this.client.get(key);
      const count = countStr ? parseInt(countStr, 10) : 0;
      return Math.max(0, maxRequests - count);
    } catch (error) {
      this.logger.error(`Failed to get rate limit for: ${identifier}`, error);
      return maxRequests;
    }
  }

  // Cache email template
  async cacheTemplate(
    templateCode: string,
    content: string,
    ttlSeconds: number = 3600,
  ): Promise<void> {
    const key = `template:${templateCode}`;
    await this.set(
      key,
      { content, cached_at: new Date().toISOString() },
      ttlSeconds,
    );
  }

  // Get cached template
  async getCachedTemplate(templateCode: string): Promise<string | null> {
    const key = `template:${templateCode}`;
    const cached = await this.get<{ content: string }>(key);
    return cached ? cached.content : null;
  }

  // Invalidate template cache
  async invalidateTemplate(templateCode: string): Promise<void> {
    const key = `template:${templateCode}`;
    await this.delete(key);
  }

  // Cache user notification preferences
  async cacheUserPreferences(
    userId: string,
    preferences: any,
    ttlSeconds: number = 1800,
  ): Promise<void> {
    const key = `user_prefs:${userId}`;
    await this.set(key, preferences, ttlSeconds);
  }

  // Get cached user preferences
  async getCachedUserPreferences(userId: string): Promise<any | null> {
    const key = `user_prefs:${userId}`;
    return await this.get(key);
  }

  // Store circuit breaker state (for distributed systems)
  async setCircuitBreakerState(
    serviceName: string,
    state: 'OPEN' | 'CLOSED' | 'HALF_OPEN',
    metadata: any = {},
  ): Promise<void> {
    const key = `circuit_breaker:${serviceName}`;
    await this.set(
      key,
      {
        state,
        ...metadata,
        updated_at: new Date().toISOString(),
      },
      5 * 60,
    );
  }

  // Get circuit breaker state
  async getCircuitBreakerState(serviceName: string): Promise<any | null> {
    const key = `circuit_breaker:${serviceName}`;
    return await this.get(key);
  }

  // Increment counter (for metrics)
  async incrementCounter(metric: string, amount: number = 1): Promise<void> {
    const key = `metric:${metric}`;
    try {
      await this.client.incrBy(key, amount);
    } catch (error) {
      this.logger.error(`Failed to increment counter: ${metric}`, error);
    }
  }

  // Get counter value
  async getCounter(metric: string): Promise<number> {
    const key = `metric:${metric}`;
    try {
      const value = await this.client.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      this.logger.error(`Failed to get counter: ${metric}`, error);
      return 0;
    }
  }

  async pushToList(key: string, value: any): Promise<void> {
    try {
      await this.client.rPush(key, JSON.stringify(value));
    } catch (error) {
      this.logger.error(`Failed to push to list: ${key}`, error);
      throw error;
    }
  }

  // Pop from list
  async popFromList<T>(key: string): Promise<T | null> {
    try {
      const value = await this.client.lPop(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      this.logger.error(`Failed to pop from list: ${key}`, error);
      return null;
    }
  }

  // Get list length
  async getListLength(key: string): Promise<number> {
    try {
      return await this.client.lLen(key);
    } catch (error) {
      this.logger.error(`Failed to get list length: ${key}`, error);
      return 0;
    }
  }

  // Check Redis connection health
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      this.logger.error('Redis ping failed', error);
      return false;
    }
  }

  // Get Redis info
  async getInfo(): Promise<any> {
    try {
      const info = await this.client.info();
      return {
        connected: this.client.isReady,
        info: info,
      };
    } catch (error) {
      this.logger.error('Failed to get Redis info', error);
      return { connected: false };
    }
  }
}
