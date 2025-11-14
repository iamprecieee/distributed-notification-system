import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RabbitMQService } from 'src/modules/rabbitmq/rabbitmq.service';
import { RedisService } from 'src/modules/redis/redis.service';
import { EmailMessage } from 'src/common/interfaces/index.interface';
import { EmailService } from '../email.service';
import { TemplateService } from '../templates/template.service';
import { StatusService } from '../status/status.service';

@Injectable()
export class EmailProcessor implements OnModuleInit {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private rabbitMQService: RabbitMQService,
    private emailService: EmailService,
    private templateService: TemplateService,
    private statusService: StatusService,
    private redisService: RedisService,
  ) {}

  async onModuleInit() {
    await new Promise(resolve => setTimeout(resolve, 2000));
    this.startConsuming();
  }

  private startConsuming() {
    this.rabbitMQService.consume(
      'email.queue',
      async (message: EmailMessage) => {
        await this.processEmail(message);
      },
      { prefetch: 10 }
    );

    this.logger.log('Started consuming from email.queue');
  }

  private async processEmail(message: EmailMessage) {
    const startTime = Date.now();
    
    try {
      // Distributed idempotency check using Redis (24h TTL)
      const alreadyProcessed = await this.redisService.checkAndMarkProcessed(
        message.request_id,
        86400 // 24 hours
      );

      if (alreadyProcessed) {
        this.logger.warn(`Duplicate message detected (Redis): ${message.request_id}`);
        return;
      }

      this.logger.log(`Processing email notification: ${message.notification_id}`);

      // Increment processing counter
      await this.redisService.incrementCounter('emails_processed');

      // Update status to pending
      await this.statusService.updateStatus({
        notification_id: message.notification_id,
        status: 'pending',
        timestamp: new Date(),
      });

      // Fetch and render template (with Redis caching)
      const template = await this.templateService.getTemplate(message.template_code);
      const renderedHtml = this.templateService.renderTemplate(template, message.variables);

      // Extract subject from variables or use default
      const subject = message.variables.subject || 'Notification';

      // Send email with circuit breaker
      const result = await this.emailService.sendEmail({
        to: message.to_email,
        subject,
        html: renderedHtml,
      });

      if (result.success) {
        // Update status to delivered
        await this.statusService.updateStatus({
          notification_id: message.notification_id,
          status: 'delivered',
          timestamp: new Date(),
          metadata: {
            message_id: result.messageId,
            processing_time_ms: Date.now() - startTime,
          },
        });

        // Increment success counter
        await this.redisService.incrementCounter('emails_delivered');

        this.logger.log(`Email delivered successfully: ${message.notification_id}`);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      this.logger.error(`Failed to process email: ${message.notification_id}`, error);

      // Increment failure counter
      await this.redisService.incrementCounter('emails_failed');

      // Update status to failed
      await this.statusService.updateStatus({
        notification_id: message.notification_id,
        status: 'failed',
        timestamp: new Date(),
        error: error.message,
        metadata: {
          processing_time_ms: Date.now() - startTime,
          retry_count: message.retry_count || 0,
        },
      });

      throw error;
    }
  }
}