import { Test, TestingModule } from '@nestjs/testing';
import { EmailService } from '../email.service';
import { CircuitBreakerService } from '../circuit-breaker/circuit-breaker.service';
import * as nodemailer from 'nodemailer';

// Mock nodemailer
jest.mock('nodemailer');

describe('EmailService', () => {
  let service: EmailService;
  let mockCircuitBreaker: jest.Mocked<CircuitBreakerService>;
  let mockTransporter: any;

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock transporter
    mockTransporter = {
      sendMail: jest.fn(),
      verify: jest.fn((callback) => callback(null, true)),
    };

    (nodemailer.createTransport as jest.Mock).mockReturnValue(mockTransporter);

    // Mock circuit breaker
    mockCircuitBreaker = {
      execute: jest.fn((fn) => fn()),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: CircuitBreakerService, useValue: mockCircuitBreaker },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  describe('sendEmail', () => {
    it('should send email successfully', async () => {
      const mockMessageId = 'test-message-id-123';
      mockTransporter.sendMail.mockResolvedValue({ messageId: mockMessageId });

      const result = await service.sendEmail({
        to: 'test@example.com',
        subject: 'Test Subject',
        html: '<p>Test email body</p>',
      });

      expect(result.success).toBe(true);
      expect(result.message_id).toBe(mockMessageId);
      expect(mockCircuitBreaker.execute).toHaveBeenCalledTimes(1);
      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Subject',
          html: '<p>Test email body</p>',
        })
      );
    });

    it('should include text version if not provided', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      await service.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Hello World</p>',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Hello World',
        })
      );
    });

    it('should use provided text version', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      await service.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>HTML version</p>',
        text: 'Plain text version',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Plain text version',
        })
      );
    });

    it('should return error when email sending fails', async () => {
      const errorMessage = 'SMTP connection failed';
      mockTransporter.sendMail.mockRejectedValue(new Error(errorMessage));

      const result = await service.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(errorMessage);
      expect(result.message_id).toBeUndefined();
    });

    it('should use circuit breaker for execution', async () => {
      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      await service.sendEmail({
        to: 'test@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(mockCircuitBreaker.execute).toHaveBeenCalledTimes(1);
      expect(mockCircuitBreaker.execute).toHaveBeenCalledWith(expect.any(Function));
    });

    it('should use correct SMTP configuration from env', async () => {
      process.env.SMTP_HOST = 'smtp.test.com';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_USER = 'test@test.com';
      process.env.SMTP_PASSWORD = 'testpass';
      process.env.SMTP_FROM = 'sender@test.com';

      mockTransporter.sendMail.mockResolvedValue({ messageId: 'test-id' });

      await service.sendEmail({
        to: 'recipient@example.com',
        subject: 'Test',
        html: '<p>Test</p>',
      });

      expect(mockTransporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'sender@test.com',
        })
      );
    });
  });

  describe('transporter initialization', () => {
    it('should create transporter with default config', () => {
      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: expect.any(String),
          port: expect.any(Number),
          secure: false,
        })
      );
    });

    it('should verify connection on initialization', () => {
      expect(mockTransporter.verify).toHaveBeenCalledTimes(1);
    });
  });
});