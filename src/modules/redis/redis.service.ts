import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis;

  constructor(
    private readonly configService: ConfigService,
    @InjectPinoLogger(RedisService.name)
    private readonly logger: PinoLogger,
  ) {
    const host = this.configService.get<string>('redis.host') || 'localhost';
    const port = this.configService.get<number>('redis.port') || 6379;
    const password = this.configService.get<string>('redis.password');

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
    });

    this.client.on('connect', () => {
      this.logger.info('Redis client connected');
    });

    this.client.on('error', (error: Error) => {
      this.logger.error({ error: error.message }, 'Redis client error');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.ping();
      this.logger.info('Redis connection established successfully');
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to connect to Redis',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit();
    this.logger.info('Redis connection closed');
  }

  // Get value from cache
  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          key,
        },
        'Failed to get value from Redis',
      );
      return null;
    }
  }

  // Set value with optional TTL (in seconds)
  async set(key: string, value: string, ttl?: number): Promise<void> {
    try {
      if (ttl) {
        await this.client.setex(key, ttl, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          key,
        },
        'Failed to set value in Redis',
      );
    }
  }

  // Delete key
  async del(key: string): Promise<void> {
    try {
      await this.client.del(key);
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          key,
        },
        'Failed to delete key from Redis',
      );
    }
  }

  // Check if key exists
  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          key,
        },
        'Failed to check key existence in Redis',
      );
      return false;
    }
  }

  // Get TTL of a key
  async ttl(key: string): Promise<number> {
    try {
      return await this.client.ttl(key);
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          key,
        },
        'Failed to get TTL from Redis',
      );
      return -1;
    }
  }

  // Clear all keys
  async flushAll(): Promise<void> {
    try {
      await this.client.flushall();
      this.logger.info('Redis cache cleared');
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Failed to flush Redis',
      );
    }
  }

  // Get Redis client for advanced operations
  getClient(): Redis {
    return this.client;
  }
}
