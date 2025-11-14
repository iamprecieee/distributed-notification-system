import { Controller, Get } from '@nestjs/common';
import { CircuitBreakerService } from '../email/circuit-breaker/circuit-breaker.service';
import { RedisService } from '../redis/redis.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { CircuitState } from 'src/common/enums/index.enums';

interface HealthResponse {
  success: boolean;
  data: {
    status: 'healthy' | 'degraded';
    service: string;
    timestamp: string;
    circuit_breaker: {
      state: string;
      failure_count: number;
      success_count: number;
      last_failure_time: number | null;
    };
    redis: {
      connected: boolean;
    };
    metrics: {
      emails_processed: number;
      emails_delivered: number;
      emails_failed: number;
      success_rate: string;
    };
    uptime: number;
    memory: NodeJS.MemoryUsage;
  };
  error: null;
  message: string;
  meta: null;
}

interface RedisTestResponse {
  success: boolean;
  data: {
    redis: string;
    timestamp: string;
    info: {
      connected: boolean;
      info?: string;
    };
  };
  error: string | null;
  message: string;
  meta: null;
}

interface MetricsResponse {
  success: boolean;
  data: {
    emails: {
      processed: number;
      delivered: number;
      failed: number;
      success_rate: string;
    };
    circuit_breaker: {
      state: string;
      failure_count: number;
      success_count: number;
      last_failure_time: number | null;
    };
    timestamp: string;
  };
  error: null;
  message: string;
  meta: null;
}

@ApiTags('health')
@Controller('/')
export class HealthController {
  constructor(
    private circuitBreaker: CircuitBreakerService,
    private redisService: RedisService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Check service health' })
  @ApiResponse({ status: 200, description: 'Service health status' })
  async checkHealth(): Promise<HealthResponse> {
    const circuitStats = this.circuitBreaker.getStats();
    const redisHealthy = await this.redisService.ping();

    const isHealthy = circuitStats.state !== CircuitState.OPEN && redisHealthy;

    // Get metrics from Redis
    const emailsProcessed =
      await this.redisService.getCounter('emails_processed');
    const emailsDelivered =
      await this.redisService.getCounter('emails_delivered');
    const emailsFailed = await this.redisService.getCounter('emails_failed');

    return {
      success: true,
      data: {
        status: isHealthy ? 'healthy' : 'degraded',
        service: 'email-service',
        timestamp: new Date().toISOString(),
        circuit_breaker: circuitStats,
        redis: {
          connected: redisHealthy,
        },
        metrics: {
          emails_processed: emailsProcessed,
          emails_delivered: emailsDelivered,
          emails_failed: emailsFailed,
          success_rate:
            emailsProcessed > 0
              ? ((emailsDelivered / emailsProcessed) * 100).toFixed(2) + '%'
              : '0%',
        },
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
      error: null,
      message: isHealthy ? 'Service is healthy' : 'Service is degraded',
      meta: null,
    };
  }

  @Get('health/test-redis')
  @ApiOperation({ summary: 'Test Redis connection' })
  @ApiResponse({ status: 200, description: 'Redis connection status' })
  async testRedis(): Promise<RedisTestResponse> {
    const isConnected = await this.redisService.ping();
    const info = await this.redisService.getInfo();

    return {
      success: isConnected,
      data: {
        redis: isConnected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString(),
        info: info,
      },
      error: isConnected ? null : 'Redis connection failed',
      message: isConnected
        ? 'Redis connection healthy'
        : 'Redis connection failed',
      meta: null,
    };
  }

  @Get('metrics')
  @ApiOperation({ summary: 'Get service metrics' })
  @ApiResponse({ status: 200, description: 'Service metrics' })
  async getMetrics(): Promise<MetricsResponse> {
    const emailsProcessed =
      await this.redisService.getCounter('emails_processed');
    const emailsDelivered =
      await this.redisService.getCounter('emails_delivered');
    const emailsFailed = await this.redisService.getCounter('emails_failed');
    const circuitStats = this.circuitBreaker.getStats();

    return {
      success: true,
      data: {
        emails: {
          processed: emailsProcessed,
          delivered: emailsDelivered,
          failed: emailsFailed,
          success_rate:
            emailsProcessed > 0
              ? ((emailsDelivered / emailsProcessed) * 100).toFixed(2)
              : '0',
        },
        circuit_breaker: circuitStats,
        timestamp: new Date().toISOString(),
      },
      error: null,
      message: 'Metrics retrieved successfully',
      meta: null,
    };
  }
}
