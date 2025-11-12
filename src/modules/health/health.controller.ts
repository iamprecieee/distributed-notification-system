import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import {
  HealthCheckService,
  HealthCheck,
  TypeOrmHealthIndicator,
  HealthCheckResult,
  HealthIndicatorFunction,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
@UseGuards(JwtAuthGuard)
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redisService: RedisService,
  ) {}

  @Get()
  @Public()
  @HttpCode(HttpStatus.OK)
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  check(): Promise<HealthCheckResult> {
    const indicators: HealthIndicatorFunction[] = [
      () => this.db.pingCheck('database'),
      async (): Promise<HealthIndicatorResult> => this.checkRedis(),
    ];

    return this.health.check(indicators);
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      await this.redisService.getClient().ping();
      return {
        redis: {
          status: 'up',
        },
      };
    } catch (error) {
      return {
        redis: {
          status: 'down',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      };
    }
  }
  @Get('test-redis')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Test Redis connection' })
  async testRedis(): Promise<{ success: boolean; message: string }> {
    try {
      await this.redisService.set('test-key', 'test-value', 10);
      const value = await this.redisService.get('test-key');

      return {
        success: value === 'test-value',
        message:
          value === 'test-value'
            ? 'Redis is working correctly'
            : 'Redis connection issue',
      };
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Redis test failed',
      };
    }
  }
}
