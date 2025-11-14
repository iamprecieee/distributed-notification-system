import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { RabbitMQModule } from './modules/rabbitmq/rabbitmq.module';
import { EmailModule } from './modules/email/email.module';


@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    RabbitMQModule,
    EmailModule,
    HealthModule,
  ],
})
export class AppModule {}
