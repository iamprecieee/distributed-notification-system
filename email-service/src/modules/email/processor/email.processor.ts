import { Injectable, Logger, Controller } from '@nestjs/common';
import { EventPattern, Ctx, Payload, RmqContext } from '@nestjs/microservices';
import { RedisService } from 'src/modules/redis/redis.service';
import type { EmailMessage } from 'src/common/interfaces/index.interface';
import { EmailService } from '../email.service';
import { TemplateService } from '../templates/template.service';
import { StatusService } from '../status/status.service';

@Controller()
@Injectable()
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  constructor(
    private emailService: EmailService,
    private templateService: TemplateService,
    private statusService: StatusService,
    private redisService: RedisService,
  ) {
    this.logger.log('EmailProcessor initialized');
  }

  @EventPattern('email.queue')
  async handleEmailMessage(
    @Payload() message: EmailMessage,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    this.logger.log('=== EMAIL MESSAGE RECEIVED ===');
    this.logger.log(`Message: ${JSON.stringify(message)}`);

    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    const startTime = Date.now();

    try {
      // Distributed idempotency check using Redis (24h TTL)
      const alreadyProcessed = await this.redisService.checkAndMarkProcessed(
        message.request_id,
        86400, // 24 hours
      );

      if (alreadyProcessed) {
        this.logger.warn(
          `Duplicate message detected (Redis): ${message.request_id}`,
        );
        channel.ack(originalMsg);
        return;
      }

      this.logger.log(
        `Processing email notification: ${message.notification_id}`,
      );

      // Increment processing counter
      await this.redisService.incrementCounter('emails_processed');

      // Update status to pending (with error handling)
      try {
        await this.statusService.updateStatus({
          notification_id: message.notification_id,
          status: 'pending',
          timestamp: new Date(),
        });
      } catch (error) {
        this.logger.warn(
          `Status service unavailable, continuing without status update`,
        );
      }

      // Fetch and render template (REQUIRED - no fallback)
      const template = await this.templateService.getTemplate(
        message.template_code,
      );
      const renderedHtml = this.templateService.renderTemplate(
        template,
        message.variables,
      );
      this.logger.log(`Template rendered successfully from template service`);

      // Extract subject from variables or use default
      const subject =
        typeof message.variables.subject === 'string'
          ? message.variables.subject
          : 'Notification';

      // Send email with circuit breaker
      const result = await this.emailService.sendEmail({
        to: message.to_email,
        subject,
        html: renderedHtml,
      });

      if (result.success) {
        // Update status to delivered (with error handling)
        try {
          await this.statusService.updateStatus({
            notification_id: message.notification_id,
            status: 'delivered',
            timestamp: new Date(),
            metadata: {
              message_id: result.message_id,
              processing_time_ms: Date.now() - startTime,
            },
          });
        } catch (error) {
          this.logger.warn(
            `Status service unavailable, email delivered but status not updated`,
          );
        }

        // Increment success counter
        await this.redisService.incrementCounter('emails_delivered');

        this.logger.log(
          `Email delivered successfully: ${message.notification_id}`,
        );

        // Acknowledge the message
        channel.ack(originalMsg);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `Failed to process email: ${message.notification_id}`,
        errorMessage,
      );

      // Increment failure counter
      await this.redisService.incrementCounter('emails_failed');

      // Update status to failed (with error handling)
      try {
        await this.statusService.updateStatus({
          notification_id: message.notification_id,
          status: 'failed',
          timestamp: new Date(),
          error: errorMessage,
          metadata: {
            processing_time_ms: Date.now() - startTime,
            retry_count: message.retry_count || 0,
          },
        });
      } catch (statusError) {
        this.logger.warn(`Status service unavailable during error handling`);
      }

      // Reject and handle retry logic
      const retryCount = message.retry_count || 0;
      if (retryCount < 3) {
        // Requeue for retry
        this.logger.warn(
          `Requeueing message ${message.notification_id} (retry ${retryCount + 1}/3)`,
        );
        channel.nack(originalMsg, false, true);
      } else {
        // Send to dead letter queue
        this.logger.error(
          `Max retries reached for ${message.notification_id}, sending to DLQ`,
        );
        channel.nack(originalMsg, false, false);
      }
    }
  }
}
