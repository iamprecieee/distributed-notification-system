import {
  Injectable,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Redis } from 'ioredis';
import { v4 as uuidv4 } from 'uuid';
import { SendNotificationDto } from './dto/send-notification.dto';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject('RABBITMQ_CLIENT') private readonly rabbitMQClient: ClientProxy,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService
  ) {}

  /**
   * Gateway's core responsibility: Route notifications to queues
   */
  async sendNotification(
    dto: SendNotificationDto,
    idempotencyKey: string,
    user: any
  ) {
    // Check idempotency
    const idempotencyCheck = await this.redis.get(
      `idempotency:${idempotencyKey}`
    );
    if (idempotencyCheck) {
      throw new BadRequestException('Duplicate request detected');
    }

    // const notificationId = uuidv4();

    try {
      this.logger.log(`Processing notification: ${dto.request_id}`);

      // Store idempotency key for 24 hours
      await this.redis.setex(`idempotency:${idempotencyKey}`, 86400, '1');

      // Store notification status
      await this.storeNotificationStatus(dto.request_id, dto, dto.user_id);

      // Determine queues based on type
      const queues = this.getQueuesForType(dto.notification_type);

      // Publish to RabbitMQ queues
      const message = {
        notification_id: dto.request_id,
        idempotency_key: idempotencyKey,
        ...dto,
        created_by: dto.user_id,
        timestamp: new Date().toISOString(),
        push_token: user?.preferences?.push ? user.push_token : undefined,
      };

      for (const queue of queues) {
        this.rabbitMQClient.emit(queue, message);
        this.logger.log(`📤 Message sent to queue: ${queue}`);
      }

      return {
        success: true,
        data: {
          notification_id: dto.request_id,
          status: 'queued',
          queues: queues,
        },
        message: 'Notification queued successfully',
        meta: null,
      };
    } catch (error) {
      this.logger.error(`Failed to queue notification: ${error.message}`);
      await this.storeNotificationStatus(
        dto.request_id,
        dto,
        dto.user_id,
        'failed'
      );
      throw error;
    }
  }

  /**
   * Get notification status from Redis
   */
  async getStatus(notificationId: string) {
    const status = await this.redis.get(`notification:${notificationId}`);

    if (!status) {
      throw new BadRequestException('Notification not found or expired');
    }

    return {
      success: true,
      data: JSON.parse(status),
      message: 'Notification status retrieved',
      meta: null,
    };
  }

  /**
   * Store notification status in Redis
   */
  private async storeNotificationStatus(
    notificationId: string,
    dto: SendNotificationDto,
    createdBy: string,
    status: string = 'pending'
  ): Promise<void> {
    const data = {
      notification_id: notificationId,
      status,
      type: dto.notification_type,
      user_id: dto.user_id,
      template_code: dto.template_code,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.redis.setex(
      `notification:${notificationId}`,
      3600,
      JSON.stringify(data)
    );
  }

  /**
   * Determine queues based on notification type
   */
  private getQueuesForType(type: string): string[] {
    const prefix = this.configService.get<string>('rabbitmq.queuePrefix');

    switch (type) {
      case 'email':
        return [`${prefix}.email.queue`];
      case 'push':
        return [`${prefix}.push.queue`];
      default:
        throw new BadRequestException(`Invalid notification type: ${type}`);
    }
  }
}
