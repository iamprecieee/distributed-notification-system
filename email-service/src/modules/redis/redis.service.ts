import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

interface CachedTemplate {
  content: string;
  cached_at: string;
}

interface CircuitBreakerMetadata {
  failure_count?: number;
  success_count?: number;
  last_failure_time?: number | null;
}

interface CircuitBreakerState {
  state: 'OPEN' | 'CLOSED' | 'HALF_OPEN';
  updated_at: string;
  failure_count?: number;
  success_count?: number;
  last_failure_time?: number | null;
}

interface IdempotencyRecord {
  processed_at: string;
}

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: RedisClientType | null = null;
  private readonly logger = new Logger(RedisService.name);

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        this.client = createClient({
          url: process.env.REDIS_URL || 'redis://localhost:6379',
          socket: {
            reconnectStrategy: (retries: number) => {
              if (retries > 10) {
                this.logger.error('Max Redis reconnection attempts reached');
                return new Error('Max reconnection attempts reached');
              }
              return Math.min(retries * 100, 3000);
            },
          },
        });

        this.client.on('error', (err: Error) => {
          this.logger.error('Redis Client Error', err.message);
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
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to connect to Redis (attempt ${retries}/${maxRetries})`,
          errorMessage,
        );
        if (retries < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }

    throw new Error('Could not connect to Redis after multiple attempts');
  }

  private async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  private ensureClient(): RedisClientType {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }
    return this.client;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    try {
      const client = this.ensureClient();
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await client.setEx(key, ttlSeconds, serialized);
      } else {
        await client.set(key, serialized);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to set key: ${key}`, errorMessage);
      throw error;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const client = this.ensureClient();
      const value = await client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to get key: ${key}`, errorMessage);
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.del(key);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to delete key: ${key}`, errorMessage);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = this.ensureClient();
      const result = await client.exists(key);
      return result === 1;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to check existence of key: ${key}`,
        errorMessage,
      );
      return false;
    }
  }

  async expire(key: string, seconds: number): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.expire(key, seconds);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to set expiration on key: ${key}`,
        errorMessage,
      );
      throw error;
    }
  }

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

      const record: IdempotencyRecord = {
        processed_at: new Date().toISOString(),
      };
      await this.set(key, record, ttlSeconds);
      return false;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Idempotency check failed for: ${requestId}`,
        errorMessage,
      );
      return false;
    }
  }

  async clearIdempotency(requestId: string): Promise<void> {
    const key = `idempotency:${requestId}`;
    await this.delete(key);
  }

  async incrementRateLimit(
    identifier: string,
    windowSeconds: number = 60,
  ): Promise<number> {
    const key = `rate_limit:${identifier}`;
    try {
      const client = this.ensureClient();
      const count = await client.incr(key);

      if (count === 1) {
        await this.expire(key, windowSeconds);
      }

      return count;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Rate limit increment failed for: ${identifier}`,
        errorMessage,
      );
      return 0;
    }
  }

  async isRateLimitExceeded(
    identifier: string,
    maxRequests: number,
    windowSeconds: number = 60,
  ): Promise<boolean> {
    const count = await this.incrementRateLimit(identifier, windowSeconds);
    return count > maxRequests;
  }

  async getRateLimitRemaining(
    identifier: string,
    maxRequests: number,
  ): Promise<number> {
    const key = `rate_limit:${identifier}`;
    try {
      const client = this.ensureClient();
      const countStr = await client.get(key);
      const count = countStr ? parseInt(countStr, 10) : 0;
      return Math.max(0, maxRequests - count);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to get rate limit for: ${identifier}`,
        errorMessage,
      );
      return maxRequests;
    }
  }

  async cacheTemplate(
    templateCode: string,
    content: string,
    ttlSeconds: number = 3600,
  ): Promise<void> {
    const key = `template:${templateCode}`;
    const template: CachedTemplate = {
      content,
      cached_at: new Date().toISOString(),
    };
    await this.set(key, template, ttlSeconds);
  }

  async getCachedTemplate(templateCode: string): Promise<string | null> {
    const key = `template:${templateCode}`;
    const cached = await this.get<CachedTemplate>(key);
    return cached ? cached.content : null;
  }

  async invalidateTemplate(templateCode: string): Promise<void> {
    const key = `template:${templateCode}`;
    await this.delete(key);
  }

  async cacheUserPreferences<T>(
    userId: string,
    preferences: T,
    ttlSeconds: number = 1800,
  ): Promise<void> {
    const key = `user_prefs:${userId}`;
    await this.set(key, preferences, ttlSeconds);
  }

  async getCachedUserPreferences<T>(userId: string): Promise<T | null> {
    const key = `user_prefs:${userId}`;
    return await this.get<T>(key);
  }

  async setCircuitBreakerState(
    serviceName: string,
    state: 'OPEN' | 'CLOSED' | 'HALF_OPEN',
    metadata: CircuitBreakerMetadata = {},
  ): Promise<void> {
    const key = `circuit_breaker:${serviceName}`;
    const stateData: CircuitBreakerState = {
      state,
      ...metadata,
      updated_at: new Date().toISOString(),
    };
    await this.set(key, stateData, 5 * 60);
  }

  async getCircuitBreakerState(
    serviceName: string,
  ): Promise<CircuitBreakerState | null> {
    const key = `circuit_breaker:${serviceName}`;
    return await this.get<CircuitBreakerState>(key);
  }

  async incrementCounter(metric: string, amount: number = 1): Promise<void> {
    const key = `metric:${metric}`;
    try {
      const client = this.ensureClient();
      await client.incrBy(key, amount);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to increment counter: ${metric}`, errorMessage);
    }
  }

  async getCounter(metric: string): Promise<number> {
    const key = `metric:${metric}`;
    try {
      const client = this.ensureClient();
      const value = await client.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to get counter: ${metric}`, errorMessage);
      return 0;
    }
  }

  async pushToList(key: string, value: unknown): Promise<void> {
    try {
      const client = this.ensureClient();
      await client.rPush(key, JSON.stringify(value));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to push to list: ${key}`, errorMessage);
      throw error;
    }
  }

  async popFromList<T>(key: string): Promise<T | null> {
    try {
      const client = this.ensureClient();
      const value = await client.lPop(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to pop from list: ${key}`, errorMessage);
      return null;
    }
  }

  async getListLength(key: string): Promise<number> {
    try {
      const client = this.ensureClient();
      return await client.lLen(key);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Failed to get list length: ${key}`, errorMessage);
      return 0;
    }
  }

  async ping(): Promise<boolean> {
    try {
      const client = this.ensureClient();
      const result = await client.ping();
      return result === 'PONG';
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Redis ping failed', errorMessage);
      return false;
    }
  }

  async getInfo(): Promise<{ connected: boolean; info?: string }> {
    try {
      const client = this.ensureClient();
      const info = await client.info();
      return {
        connected: client.isReady,
        info: info,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error('Failed to get Redis info', errorMessage);
      return { connected: false };
    }
  }
}
