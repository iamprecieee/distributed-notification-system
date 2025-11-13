import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { EmailService } from './email.service';
import { EmailProcessor } from './processor/email.processor';
import { TemplateService } from './templates/template.service';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';
import { StatusService } from './status/status.service';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [HttpModule, RedisModule],
  providers: [
    EmailService,
    EmailProcessor,
    TemplateService,
    CircuitBreakerService,
    StatusService,
    RabbitMQService
  ],
})
export class EmailModule {}