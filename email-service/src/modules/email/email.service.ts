import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { CircuitBreakerService } from './circuit-breaker/circuit-breaker.service';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailResult {
  success: boolean;
  message_id?: string;
  error?: string;
}

interface NodemailerResponse {
  messageId: string;
  envelope: {
    from: string;
    to: string[];
  };
  accepted: string[];
  rejected: string[];
  response: string;
}

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;
  private readonly logger = new Logger(EmailService.name);

  constructor(private circuitBreaker: CircuitBreakerService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    this.transporter.verify((error: Error | null) => {
      if (error) {
        this.logger.error('SMTP connection failed', error.message);
      } else {
        this.logger.log('SMTP server ready');
      }
    });
  }

  async sendEmail(options: EmailOptions): Promise<EmailResult> {
    return this.circuitBreaker.execute(async () => {
      try {
        const info = (await this.transporter.sendMail({
          from: process.env.SMTP_FROM || 'notifications@example.com',
          to: options.to,
          subject: options.subject,
          html: options.html,
          text: options.text || options.html.replace(/<[^>]*>/g, ''),
        })) as unknown as NodemailerResponse;

        const message_id = String(info.messageId || '');

        this.logger.log(
          `Email sent successfully to ${options.to}: ${message_id}`,
        );
        return {
          success: true,
          message_id,
        };
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(
          `Failed to send email to ${options.to}`,
          errorMessage,
        );
        return {
          success: false,
          error: errorMessage,
        };
      }
    });
  }
}
