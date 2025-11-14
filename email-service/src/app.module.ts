import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { RabbitMQModule } from './modules/rabbitmq/rabbitmq.module';
import { EmailModule } from './modules/email/email.module';
import configuration from './config/configuration';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    RabbitMQModule,
    EmailModule,
    HealthModule,
  ],
})
export class AppModule {}
