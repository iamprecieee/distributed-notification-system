import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom, timeout } from 'rxjs';

@Injectable()
export class RabbitMQService implements OnModuleInit {
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(
    @Inject('RABBITMQ_CLIENT') private readonly client: ClientProxy
  ) {}

  async onModuleInit() {
    try {
      await this.client.connect();
      this.logger.log('✅ RabbitMQ connection established');
    } catch (error) {
      this.logger.error('❌ Failed to connect to RabbitMQ:', error);
    }
  }

  async publishToQueue(queue: string, message: any): Promise<void> {
    try {
      this.client.emit(queue, message);
      this.logger.log(`📤 Message published to queue: ${queue}`);
    } catch (error) {
      this.logger.error(`Failed to publish to ${queue}:`, error);
      throw error;
    }
  }

  async sendWithResponse<T>(pattern: string, data: any): Promise<T> {
    try {
      const response$ = this.client.send<T>(pattern, data).pipe(timeout(5000));
      return await lastValueFrom(response$);
    } catch (error) {
      this.logger.error(
        `Failed to send message with pattern ${pattern}:`,
        error
      );
      throw error;
    }
  }
}
