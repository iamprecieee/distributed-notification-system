import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { CircuitBreakerService } from '../email/circuit-breaker/circuit-breaker.service';
import { RedisService } from '../redis/redis.service';

@Module({
  controllers: [HealthController],
  providers: [CircuitBreakerService, RedisService],
})
export class HealthModule {}
