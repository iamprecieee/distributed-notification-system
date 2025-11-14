import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from '../email.service';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import { RedisService } from 'src/modules/redis/redis.service';
import * as nodemailer from 'nodemailer';

describe('EmailService Integration Tests', () => {
  let service: EmailService;
  let circuitBreaker: CircuitBreakerService;
  let testAccount: nodemailer.TestAccount;

  beforeAll(async () => {
    // Create Ethereal test account for testing
    testAccount = await nodemailer.createTestAccount();

    // Set test SMTP credentials
    process.env.SMTP_HOST = 'smtp.ethereal.email';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = testAccount.user;
    process.env.SMTP_PASSWORD = testAccount.pass;
    process.env.SMTP_FROM = testAccount.user;
  });

  beforeEach(async () => {
    // Mock Redis Service
    const mockRedisService = {
      getCircuitBreakerState: jest.fn().mockResolvedValue(null),
      setCircuitBreakerState: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        CircuitBreakerService,
        { provide: RedisService, useValue: mockRedisService },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    circuitBreaker = module.get<CircuitBreakerService>(CircuitBreakerService);

    // Wait for transporter to be ready
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  describe('Real SMTP Email Sending', () => {
    it('should send email through Ethereal SMTP', async () => {
      const result = await service.sendEmail({
        to: 'recipient@example.com',
        subject: 'Integration Test Email',
        html: '<h1>Hello from Integration Test</h1><p>This is a test email.</p>',
      });

      expect(result.success).toBe(true);
      expect(result.message_id).toBeDefined();
      expect(result.error).toBeUndefined();

      // Get preview URL
      if (result.message_id) {
        const previewUrl = nodemailer.getTestMessageUrl({
          messageId: result.message_id,
        } as nodemailer.SentMessageInfo);
        console.log('📧 Preview email at:', previewUrl);
      }
    }, 10000);

    it('should send email with plain text fallback', async () => {
      const result = await service.sendEmail({
        to: 'test@example.com',
        subject: 'Text Email Test',
        html: '<p>HTML content</p>',
        text: 'Plain text content',
      });

      expect(result.success).toBe(true);
      expect(result.message_id).toBeDefined();

      const previewUrl = nodemailer.getTestMessageUrl({
        messageId: result.message_id,
      } as nodemailer.SentMessageInfo);
      console.log('📧 Preview email at:', previewUrl);
    }, 10000);

    it('should send email with template variables', async () => {
      const html = `
        <html>
          <body>
            <h2>Welcome John Doe!</h2>
            <p>Your account has been created successfully.</p>
            <a href="https://example.com/verify?token=abc123">Verify Email</a>
          </body>
        </html>
      `;

      const result = await service.sendEmail({
        to: 'newuser@example.com',
        subject: 'Welcome to Our Platform',
        html,
      });

      expect(result.success).toBe(true);
      expect(result.message_id).toBeDefined();

      const previewUrl = nodemailer.getTestMessageUrl({
        messageId: result.message_id,
      } as nodemailer.SentMessageInfo);
      console.log('📧 Preview email at:', previewUrl);
    }, 10000);
  });

  describe('Circuit Breaker Integration', () => {
    it('should handle email sending through circuit breaker', async () => {
      const executeSpy = jest.spyOn(circuitBreaker, 'execute');

      const result = await service.sendEmail({
        to: 'test@example.com',
        subject: 'Circuit Breaker Test',
        html: '<p>Testing circuit breaker</p>',
      });

      expect(executeSpy).toHaveBeenCalled();
      expect(result.success).toBe(true);
    }, 10000);

    it('should return error when SMTP fails', async () => {
      // Temporarily break the connection by using invalid credentials
      process.env.SMTP_PASSWORD = 'invalid-password';

      // Recreate service with broken credentials
      const brokenModule = await Test.createTestingModule({
        providers: [
          EmailService,
          CircuitBreakerService,
          {
            provide: RedisService,
            useValue: {
              getCircuitBreakerState: jest.fn().mockResolvedValue(null),
              setCircuitBreakerState: jest.fn().mockResolvedValue(undefined),
            },
          },
        ],
      }).compile();

      const brokenService = brokenModule.get<EmailService>(EmailService);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const result = await brokenService.sendEmail({
        to: 'test@example.com',
        subject: 'Should Fail',
        html: '<p>This should fail</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();

      // Restore credentials
      process.env.SMTP_PASSWORD = testAccount.pass;
    }, 15000);
  });

  describe('Multiple Email Sending', () => {
    it('should send multiple emails in sequence', async () => {
      const emails = [
        {
          to: 'user1@example.com',
          subject: 'Email 1',
          html: '<p>First email</p>',
        },
        {
          to: 'user2@example.com',
          subject: 'Email 2',
          html: '<p>Second email</p>',
        },
        {
          to: 'user3@example.com',
          subject: 'Email 3',
          html: '<p>Third email</p>',
        },
      ];

      const results = [];
      for (const email of emails) {
        const result = await service.sendEmail(email);
        results.push(result);
      }

      expect(results).toHaveLength(3);
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.message_id).toBeDefined();
      });

      console.log('📧 All emails sent successfully');
      results.forEach((result, i) => {
        console.log(
          `   Email ${i + 1}:`,
          nodemailer.getTestMessageUrl({
            messageId: result.message_id,
          } as nodemailer.SentMessageInfo),
        );
      });
    }, 30000);

    it('should handle concurrent email sending', async () => {
      const emails = Array.from({ length: 5 }, (_, i) => ({
        to: `user${i}@example.com`,
        subject: `Concurrent Email ${i}`,
        html: `<p>Email number ${i}</p>`,
      }));

      const results = await Promise.all(
        emails.map((email) => service.sendEmail(email)),
      );

      expect(results).toHaveLength(5);
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.message_id).toBeDefined();
      });

      console.log('📧 All concurrent emails sent successfully');
    }, 30000);
  });
});
