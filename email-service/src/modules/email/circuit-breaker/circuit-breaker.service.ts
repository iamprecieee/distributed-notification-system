import { Injectable, Logger } from '@nestjs/common';
import { CircuitState } from 'src/common/enums/index.enums';
import { CircuitBreakerStats } from 'src/common/interfaces/index.interface';
import { RedisService } from 'src/modules/redis/redis.service';

@Injectable()
export class CircuitBreakerService {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private readonly logger = new Logger(CircuitBreakerService.name);

  private readonly FAILURE_THRESHOLD = 5;
  private readonly SUCCESS_THRESHOLD = 2;
  private readonly TIMEOUT = 60000; // 60 seconds

  constructor(private redisService: RedisService) {
    void this.syncStateFromRedis();
  }

  private async syncStateFromRedis(): Promise<void> {
    try {
      const redisState = await this.redisService.getCircuitBreakerState('smtp');
      if (redisState) {
        this.state = redisState.state as CircuitState;
        this.failureCount = redisState.failure_count || 0;
        this.lastFailureTime = redisState.last_failure_time || null;
        this.logger.log(
          `Circuit breaker state synced from Redis: ${this.state}`,
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        'Failed to sync circuit breaker state from Redis',
        errorMessage,
      );
    }
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check shared state from Redis
    const redisState = await this.redisService.getCircuitBreakerState('smtp');
    if (redisState && redisState.state === 'OPEN') {
      this.state = CircuitState.OPEN;
      this.lastFailureTime = redisState.last_failure_time || null;
    }

    if (this.state === CircuitState.OPEN) {
      if (
        this.lastFailureTime &&
        Date.now() - this.lastFailureTime >= this.TIMEOUT
      ) {
        this.logger.log('Circuit breaker entering HALF_OPEN state');
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        await this.updateRedisState();
      } else {
        throw new Error('Circuit breaker is OPEN');
      }
    }

    try {
      const result = await fn();
      await this.onSuccess();
      return result;
    } catch (error) {
      await this.onFailure();
      throw error;
    }
  }

  private async onSuccess(): Promise<void> {
    this.failureCount = 0;

    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.SUCCESS_THRESHOLD) {
        this.logger.log('Circuit breaker closing');
        this.state = CircuitState.CLOSED;
        this.successCount = 0;
        await this.updateRedisState();
      }
    }
  }

  private async onFailure(): Promise<void> {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.successCount = 0;

    if (this.failureCount >= this.FAILURE_THRESHOLD) {
      this.logger.error('Circuit breaker opening due to failures');
      this.state = CircuitState.OPEN;
      await this.updateRedisState();
    }
  }

  private async updateRedisState(): Promise<void> {
    try {
      await this.redisService.setCircuitBreakerState('smtp', this.state, {
        failure_count: this.failureCount,
        success_count: this.successCount,
        last_failure_time: this.lastFailureTime,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        'Failed to update circuit breaker state in Redis',
        errorMessage,
      );
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      failure_count: this.failureCount,
      success_count: this.successCount,
      last_failure_time: this.lastFailureTime,
    };
  }
}
