import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import * as amqp from 'amqplib';
import { Connection, Channel, Message } from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: Connection;
  private channel: Channel;
  private readonly logger = new Logger(RabbitMQService.name);

  async onModuleInit() {
    await this.connect();
    await this.setupQueues();
  }

  async onModuleDestroy() {
    await this.channel?.close();
    await (this.connection as any)?.close();
  }

  private async connect() {
    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
      try {
        const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
        this.logger.log(
          `Connecting to RabbitMQ: ${url.replace(/:[^:@]+@/, ':****@')}`,
        );

        this.connection = (await amqp.connect(url)) as any;
        this.channel = await (this.connection as any).createChannel();

        this.logger.log('Connected to RabbitMQ');
        return;
      } catch (error) {
        retries++;
        this.logger.error(
          `Failed to connect to RabbitMQ (attempt ${retries}/${maxRetries}):`,
          error.message,
        );
        if (retries >= maxRetries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  }

  private async setupQueues() {
    const exchange = 'push_notifications';
    const emailQueue = 'email.queue';
    const failedQueue = 'failed.queue';

    // Declare exchange
    await this.channel.assertExchange(exchange, 'direct', { durable: true });

    // Declare dead letter exchange and queue
    await this.channel.assertExchange('dlx.exchange', 'direct', {
      durable: true,
    });
    await this.channel.assertQueue(failedQueue, {
      durable: true,
    });
    await this.channel.bindQueue(failedQueue, 'dlx.exchange', 'failed');

    // Declare email queue with DLX
    await this.channel.assertQueue(emailQueue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dlx.exchange',
        'x-dead-letter-routing-key': 'failed',
        'x-message-ttl': 3600000, // 1 hour TTL
      },
    });

    // Bind queue to exchange
    await this.channel.bindQueue(emailQueue, exchange, 'email');

    this.logger.log('Queues and exchanges configured');
  }

  async consume(
    queue: string,
    callback: (msg: any) => Promise<void>,
    options: { prefetch?: number } = {},
  ) {
    if (!this.channel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const { prefetch = 10 } = options;
    await this.channel.prefetch(prefetch);

    this.channel.consume(
      queue,
      async (msg) => {
        if (!msg) return;

        try {
          const content = JSON.parse(msg.content.toString());
          await callback(content);
          this.channel.ack(msg);
        } catch (error) {
          this.logger.error('Error processing message', error);

          const retryCount = this.getRetryCount(msg);
          const maxRetries = 3;

          if (retryCount < maxRetries) {
            // Retry with exponential backoff
            const delay = Math.pow(2, retryCount) * 1000;
            setTimeout(() => {
              this.channel.nack(msg, false, true);
            }, delay);
          } else {
            // Max retries reached, send to DLQ
            this.channel.nack(msg, false, false);
          }
        }
      },
      { noAck: false },
    );
  }

  private getRetryCount(msg: Message): number {
    const headers = msg.properties.headers || {};
    return headers['x-retry-count'] || 0;
  }

  async publish(exchange: string, routingKey: string, message: any) {
    const content = Buffer.from(JSON.stringify(message));
    return this.channel.publish(exchange, routingKey, content, {
      persistent: true,
      timestamp: Date.now(),
    });
  }

  getChannel(): Channel {
    return this.channel;
  }
}
