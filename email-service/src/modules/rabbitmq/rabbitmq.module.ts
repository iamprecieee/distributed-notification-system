import { Module, Global } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConfigService } from '@nestjs/config';
import { RabbitMQService } from './rabbitmq.service';

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: 'RABBITMQ_CLIENT',
        useFactory: (configService: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              configService.get<string>('RABBITMQ_URL') ||
                'amqp://localhost:5672',
            ],
            queue: 'email.queue',
            persistent: true,
            queueOptions: {
              durable: true,
              arguments: {
                'x-dead-letter-exchange': 'dlx.exchange',
                'x-dead-letter-routing-key': 'failed',
                'x-message-ttl': 3600000, // 1 hour
              },
            },
            prefetchCount: 10,
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [RabbitMQService],
  exports: [ClientsModule, RabbitMQService],
})
export class RabbitMQModule {}
