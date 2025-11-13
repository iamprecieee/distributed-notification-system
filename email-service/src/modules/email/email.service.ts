import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private circuitBreaker: CircuitBreakerService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    // Using Gmail SMTP - configure based on your provider
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    // Verify connection
    this.transporter.verify((error, success) => {
      if (error) {
        this.logger.error('SMTP connection failed', error);
      } else {
        this.logger.log('SMTP server ready');
      }
    });
  }

  async sendEmail(options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.circuitBreaker.execute(async () => {
      try {
        const info = await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'notifications@example.com',
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || options.html.replace(/<[^>]*>/g, ''),
        });

        this.logger.log(`Email sent successfully to ${options.to}: ${info.messageId}`);
        return {
          success: true,
          messageId: info.messageId,
        };
      } catch (error) {
        this.logger.error(`Failed to send email to ${options.to}`, error);
        return {
          success: false,
          error: error.message,
        };
      }
    });
  }
}
