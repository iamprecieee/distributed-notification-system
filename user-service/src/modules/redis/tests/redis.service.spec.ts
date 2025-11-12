import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import Redis from 'ioredis';
import { RedisService } from '../redis.service';

// Mock ioredis
jest.mock('ioredis');

describe('RedisService', () => {
  let service: RedisService;
  let logger: jest.Mocked<PinoLogger>;
  let mockRedisClient: jest.Mocked<Redis>;
  let mockRedisConstructor: jest.MockedClass<typeof Redis>;

  beforeEach(async () => {
    // Clear all constructor calls
    jest.clearAllMocks();

    // Create mock Redis client
    mockRedisClient = {
      ping: jest.fn(),
      quit: jest.fn(),
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      ttl: jest.fn(),
      flushall: jest.fn(),
      on: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    // Mock Redis constructor
    mockRedisConstructor = Redis as jest.MockedClass<typeof Redis>;
    mockRedisConstructor.mockImplementation(() => mockRedisClient);

    // Create mocked ConfigService
    const mockConfig = {
      get: jest.fn((key: string) => {
        const config: Record<string, string | number> = {
          'redis.host': 'test-host',
          'redis.port': 6380,
          'redis.password': 'test-password',
        };
        return config[key];
      }),
    };

    // Create mocked logger
    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      fatal: jest.fn(),
      trace: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
        {
          provide: `PinoLogger:${RedisService.name}`,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);
    configService = module.get(ConfigService);
    logger = module.get(`PinoLogger:${RedisService.name}`);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('constructor', () => {
    it('should initialize Redis client with config values', () => {
      expect(mockRedisConstructor).toHaveBeenCalledWith({
        host: 'test-host',
        port: 6380,
        password: 'test-password',
        retryStrategy: expect.any(Function),
        maxRetriesPerRequest: 3,
      });
    });

    it('should use default values when config is not provided', async () => {
      // Create new mock for this test
      const defaultConfigService = {
        get: jest.fn().mockReturnValue(undefined),
      };

      const defaultLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
        fatal: jest.fn(),
        trace: jest.fn(),
      };

      jest.clearAllMocks();

      await Test.createTestingModule({
        providers: [
          RedisService,
          {
            provide: ConfigService,
            useValue: defaultConfigService,
          },
          {
            provide: `PinoLogger:${RedisService.name}`,
            useValue: defaultLogger,
          },
        ],
      }).compile();

      expect(mockRedisConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'localhost',
          port: 6379,
          password: undefined,
        }),
      );
    });

    it('should setup event listeners for connect and error', () => {
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });

    it('should log when Redis connects', () => {
      // Get the connect callback
      const onCalls = (mockRedisClient.on as jest.Mock).mock.calls;
      const connectCall = onCalls.find((call) => call[0] === 'connect');

      expect(connectCall).toBeDefined();

      const connectCallback = connectCall?.[1] as () => void;
      connectCallback();

      expect(logger.info).toHaveBeenCalledWith('Redis client connected');
    });

    it('should log when Redis has an error', () => {
      // Get the error callback and call it
      const errorCallback = (mockRedisClient.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'error',
      )?.[1];

      const testError = new Error('Connection failed');
      errorCallback(testError);

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Connection failed' },
        'Redis client error',
      );
    });

    it('should implement retry strategy with exponential backoff', () => {
      const redisConfig = (Redis as jest.MockedClass<typeof Redis>).mock
        .calls[0][0];
      const retryStrategy = redisConfig.retryStrategy as (
        times: number,
      ) => number;

      expect(retryStrategy(1)).toBe(50);
      expect(retryStrategy(10)).toBe(500);
      expect(retryStrategy(50)).toBe(2000);
      expect(retryStrategy(100)).toBe(2000); // Should cap at 2000ms
    });
  });

  describe('onModuleInit', () => {
    it('should ping Redis and log success on successful connection', async () => {
      mockRedisClient.ping.mockResolvedValue('PONG');

      await service.onModuleInit();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        'Redis connection established successfully',
      );
    });

    it('should log error when ping fails', async () => {
      mockRedisClient.ping.mockRejectedValue(new Error('Connection timeout'));

      await service.onModuleInit();

      expect(mockRedisClient.ping).toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Connection timeout' },
        'Failed to connect to Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.ping.mockRejectedValue('String error');

      await service.onModuleInit();

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error' },
        'Failed to connect to Redis',
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit Redis client and log', async () => {
      mockRedisClient.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(mockRedisClient.quit).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Redis connection closed');
    });
  });

  describe('get', () => {
    it('should successfully get a value', async () => {
      mockRedisClient.get.mockResolvedValue('test-value');

      const result = await service.get('test-key');

      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
      expect(result).toBe('test-value');
    });

    it('should return null when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.get('non-existent-key');

      expect(result).toBeNull();
    });

    it('should return null and log error on failure', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));

      const result = await service.get('test-key');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Redis error', key: 'test-key' },
        'Failed to get value from Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.get.mockRejectedValue('Unknown error');

      const result = await service.get('test-key');

      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error', key: 'test-key' },
        'Failed to get value from Redis',
      );
    });
  });

  describe('set', () => {
    it('should set a value without TTL', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.set('test-key', 'test-value');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
      );
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it('should set a value with TTL', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');

      await service.set('test-key', 'test-value', 3600);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'test-key',
        3600,
        'test-value',
      );
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should log error on set failure without TTL', async () => {
      mockRedisClient.set.mockRejectedValue(new Error('Set failed'));

      await service.set('test-key', 'test-value');

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Set failed', key: 'test-key' },
        'Failed to set value in Redis',
      );
    });

    it('should log error on set failure with TTL', async () => {
      mockRedisClient.setex.mockRejectedValue(new Error('Setex failed'));

      await service.set('test-key', 'test-value', 3600);

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Setex failed', key: 'test-key' },
        'Failed to set value in Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.set.mockRejectedValue('Unknown error');

      await service.set('test-key', 'test-value');

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error', key: 'test-key' },
        'Failed to set value in Redis',
      );
    });
  });

  describe('del', () => {
    it('should successfully delete a key', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await service.del('test-key');

      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
    });

    it('should log error on delete failure', async () => {
      mockRedisClient.del.mockRejectedValue(new Error('Delete failed'));

      await service.del('test-key');

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Delete failed', key: 'test-key' },
        'Failed to delete key from Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.del.mockRejectedValue('Unknown error');

      await service.del('test-key');

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error', key: 'test-key' },
        'Failed to delete key from Redis',
      );
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockRedisClient.exists.mockResolvedValue(1);

      const result = await service.exists('test-key');

      expect(mockRedisClient.exists).toHaveBeenCalledWith('test-key');
      expect(result).toBe(true);
    });

    it('should return false when key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);

      const result = await service.exists('non-existent-key');

      expect(result).toBe(false);
    });

    it('should return false and log error on failure', async () => {
      mockRedisClient.exists.mockRejectedValue(
        new Error('Exists check failed'),
      );

      const result = await service.exists('test-key');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Exists check failed', key: 'test-key' },
        'Failed to check key existence in Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.exists.mockRejectedValue('Unknown error');

      const result = await service.exists('test-key');

      expect(result).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error', key: 'test-key' },
        'Failed to check key existence in Redis',
      );
    });
  });

  describe('ttl', () => {
    it('should return TTL value for a key', async () => {
      mockRedisClient.ttl.mockResolvedValue(3600);

      const result = await service.ttl('test-key');

      expect(mockRedisClient.ttl).toHaveBeenCalledWith('test-key');
      expect(result).toBe(3600);
    });

    it('should return -1 when key has no TTL', async () => {
      mockRedisClient.ttl.mockResolvedValue(-1);

      const result = await service.ttl('test-key');

      expect(result).toBe(-1);
    });

    it('should return -1 and log error on failure', async () => {
      mockRedisClient.ttl.mockRejectedValue(new Error('TTL check failed'));

      const result = await service.ttl('test-key');

      expect(result).toBe(-1);
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'TTL check failed', key: 'test-key' },
        'Failed to get TTL from Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.ttl.mockRejectedValue('Unknown error');

      const result = await service.ttl('test-key');

      expect(result).toBe(-1);
      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error', key: 'test-key' },
        'Failed to get TTL from Redis',
      );
    });
  });

  describe('flushAll', () => {
    it('should successfully flush all keys', async () => {
      mockRedisClient.flushall.mockResolvedValue('OK');

      await service.flushAll();

      expect(mockRedisClient.flushall).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith('Redis cache cleared');
    });

    it('should log error on flush failure', async () => {
      mockRedisClient.flushall.mockRejectedValue(new Error('Flush failed'));

      await service.flushAll();

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Flush failed' },
        'Failed to flush Redis',
      );
    });

    it('should handle unknown error types', async () => {
      mockRedisClient.flushall.mockRejectedValue('Unknown error');

      await service.flushAll();

      expect(logger.error).toHaveBeenCalledWith(
        { error: 'Unknown error' },
        'Failed to flush Redis',
      );
    });
  });

  describe('getClient', () => {
    it('should return the Redis client instance', () => {
      const client = service.getClient();

      expect(client).toBe(mockRedisClient);
    });
  });
});
