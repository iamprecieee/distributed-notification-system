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
            urls: [configService.get<string>('rabbitmq.url')],
            queue: `${configService.get<string>('rabbitmq.queuePrefix')}_main`,
            persistent: true,
            queueOptions: {
              durable: true,
              arguments: {
                'x-dead-letter-exchange': 'dlx',
                'x-dead-letter-routing-key': 'failed',
                'x-message-ttl': 3600000, // 1 hour
              },
            },
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
