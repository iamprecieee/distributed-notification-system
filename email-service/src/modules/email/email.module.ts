import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmailService } from './email.service';
import { EmailProcessor } from './processor/email.processor';
import { TemplateService } from './templates/template.service';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { StatusService } from './status/status.service';
import { RedisModule } from '../redis/redis.module';
import { RabbitMQModule } from '../rabbitmq/rabbitmq.module';

@Module({
  imports: [HttpModule, RedisModule, RabbitMQModule],
  controllers: [EmailProcessor],
  providers: [
    EmailService,
    TemplateService,
    CircuitBreakerService,
    StatusService,
  ],
  exports: [EmailService],
})
export class EmailModule {}
