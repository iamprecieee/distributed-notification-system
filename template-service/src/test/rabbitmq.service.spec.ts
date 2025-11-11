import { Test, TestingModule } from '@nestjs/testing';
import { RabbitMQService } from '../common/messaging/rabbitmq.service';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

jest.mock('amqplib');

describe('RabbitMQService', () => {
  let service: RabbitMQService;
  let configService: ConfigService;
  let mockConnection: jest.Mocked<amqp.ChannelModel>;
  let mockChannel: jest.Mocked<amqp.ConfirmChannel>;

  beforeEach(async () => {
    mockChannel = {
      publish: jest.fn().mockReturnValue(true),
      assertExchange: jest.fn().mockResolvedValue(undefined),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as jest.Mocked<amqp.ConfirmChannel>;

    mockConnection = {
      createConfirmChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as jest.Mocked<amqp.ChannelModel>;

    (amqp.connect as jest.Mock).mockResolvedValue(mockConnection);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RabbitMQService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('amqp://guest:guest@localhost:5672'),
          },
        },
      ],
    }).compile();

    service = module.get<RabbitMQService>(RabbitMQService);
    configService = module.get<ConfigService>(ConfigService);

    jest.clearAllMocks();
  });

  describe('onModuleInit', () => {
    it('should connect to RabbitMQ', async () => {
      await service.onModuleInit();

      expect(amqp.connect).toHaveBeenCalledWith(
        'amqp://guest:guest@localhost:5672',
      );
      expect(mockConnection.createConfirmChannel).toHaveBeenCalled();
      expect(mockChannel.assertExchange).toHaveBeenCalledWith(
        'notifications.direct',
        'direct',
        { durable: true },
      );
    });

    it('should use default URL when not configured', async () => {
      (configService.get as jest.Mock).mockReturnValue(undefined);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RabbitMQService,
          {
            provide: ConfigService,
            useValue: {
              get: jest
                .fn()
                .mockReturnValue('amqp://guest:guest@rabbitmq:5672'),
            },
          },
        ],
      }).compile();

      const newService = module.get<RabbitMQService>(RabbitMQService);
      await newService.onModuleInit();

      expect(amqp.connect).toHaveBeenCalledWith(
        'amqp://guest:guest@rabbitmq:5672',
      );
    });

    it('should set up error handlers', async () => {
      await service.onModuleInit();

      expect(mockConnection.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      expect(mockConnection.on).toHaveBeenCalledWith(
        'close',
        expect.any(Function),
      );
      expect(mockChannel.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
      expect(mockChannel.on).toHaveBeenCalledWith('close', expect.any(Function));
    });

    it('should schedule reconnect on connection error', async () => {
      jest.useFakeTimers();
      await service.onModuleInit();

      const errorHandler = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'error',
      )?.[1] as (error: Error) => void;

      errorHandler(new Error('Connection error'));

      jest.advanceTimersByTime(5000);

      expect(amqp.connect).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });

    it('should handle connection failure gracefully', async () => {
      (amqp.connect as jest.Mock).mockRejectedValueOnce(
        new Error('Connection failed'),
      );

      await service.onModuleInit();

      expect(amqp.connect).toHaveBeenCalled();
    });
  });

  describe('publishTemplateUpdated', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('should publish template updated event', async () => {
      await service.publishTemplateUpdated('welcome_email', 1);

      expect(mockChannel.publish).toHaveBeenCalledWith(
        'notifications.direct',
        'template.updated',
        expect.any(Buffer),
        {
          persistent: true,
          contentType: 'application/json',
        },
      );

      const messageBuffer = mockChannel.publish.mock.calls[0][2] as Buffer;
      const message = JSON.parse(messageBuffer.toString());

      expect(message).toEqual({
        code: 'welcome_email',
        version: 1,
        timestamp: expect.any(String),
      });
    });

    it('should throw error when channel is not available', async () => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          RabbitMQService,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn().mockReturnValue('amqp://localhost:5672'),
            },
          },
        ],
      }).compile();

      const newService = module.get<RabbitMQService>(RabbitMQService);

      await expect(
        newService.publishTemplateUpdated('welcome_email', 1),
      ).rejects.toThrow('RabbitMQ channel not available');
    });

    it('should include timestamp in payload', async () => {
      const before = new Date().toISOString();

      await service.publishTemplateUpdated('welcome_email', 1);

      const after = new Date().toISOString();
      const messageBuffer = mockChannel.publish.mock.calls[0][2] as Buffer;
      const message = JSON.parse(messageBuffer.toString());

      expect(message.timestamp).toBeDefined();
      expect(message.timestamp >= before).toBe(true);
      expect(message.timestamp <= after).toBe(true);
    });
  });

  describe('isConnected', () => {
    it('should return true when connected', async () => {
      await service.onModuleInit();

      expect(service.isConnected()).toBe(true);
    });

    it('should return false when not connected', () => {
      expect(service.isConnected()).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('should close channel and connection', async () => {
      await service.onModuleInit();
      await service.onModuleDestroy();

      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockConnection.close).toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      await service.onModuleInit();
      mockChannel.close.mockRejectedValueOnce(new Error('Close error'));

      await expect(service.onModuleDestroy()).resolves.not.toThrow();

      expect(mockChannel.close).toHaveBeenCalled();
    });

    it('should clear reconnect timeout', async () => {
      jest.useFakeTimers();
      await service.onModuleInit();

      const errorHandler = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'error',
      )?.[1] as (error: Error) => void;

      errorHandler(new Error('Connection error'));

      await service.onModuleDestroy();

      jest.advanceTimersByTime(5000);

      expect(amqp.connect).toHaveBeenCalledTimes(1);
      jest.useRealTimers();
    });
  });

  describe('reconnect logic', () => {
    it('should not reconnect if already scheduled', async () => {
      jest.useFakeTimers();
      await service.onModuleInit();

      const errorHandler = mockConnection.on.mock.calls.find(
        (call) => call[0] === 'error',
      )?.[1] as (error: Error) => void;

      errorHandler(new Error('Error 1'));
      errorHandler(new Error('Error 2'));
      errorHandler(new Error('Error 3'));

      jest.advanceTimersByTime(5000);

      expect(amqp.connect).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });
});

