import { Test, TestingModule } from '@nestjs/testing';
import { RedisService } from '../common/redis/redis.service';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

jest.mock('ioredis');

describe('RedisService', () => {
  let service: RedisService;
  let mockRedisClient: jest.Mocked<Redis>;

  beforeEach(async () => {
    mockRedisClient = {
      get: jest.fn(),
      set: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      keys: jest.fn(),
      flushall: jest.fn(),
      quit: jest.fn(),
      on: jest.fn(),
    } as unknown as jest.Mocked<Redis>;

    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => {
      return mockRedisClient;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RedisService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue('redis://localhost:6379'),
          },
        },
      ],
    }).compile();

    service = module.get<RedisService>(RedisService);

    await service.onModuleInit();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    if (service) {
      try {
        await service.onModuleDestroy();
      } catch {
      }
    }
  });

  describe('get', () => {
    it('should return parsed JSON object', async () => {
      const testObject = { key: 'value' };
      mockRedisClient.get.mockResolvedValue(JSON.stringify(testObject));

      const result = await service.get<{ key: string }>('test-key');

      expect(result).toEqual(testObject);
      expect(mockRedisClient.get).toHaveBeenCalledWith('test-key');
    });

    it('should return string when value is not JSON', async () => {
      mockRedisClient.get.mockResolvedValue('simple-string');

      const result = await service.get<string>('test-key');

      expect(result).toBe('simple-string');
    });

    it('should return null when key does not exist', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const result = await service.get('test-key');

      expect(result).toBeNull();
    });

    it('should return string as-is when JSON parsing fails', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json{');

      const result = await service.get<string>('test-key');

      expect(result).toBe('invalid-json{');
    });
  });

  describe('set', () => {
    it('should set value without TTL', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.set('test-key', 'test-value');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'test-value',
      );
      expect(mockRedisClient.setex).not.toHaveBeenCalled();
    });

    it('should set value with TTL', async () => {
      mockRedisClient.setex.mockResolvedValue('OK');

      await service.set('test-key', 'test-value', 3600);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'test-key',
        3600,
        'test-value',
      );
      expect(mockRedisClient.set).not.toHaveBeenCalled();
    });

    it('should serialize object to JSON', async () => {
      const testObject = { key: 'value' };
      mockRedisClient.setex.mockResolvedValue('OK');

      await service.set('test-key', testObject, 3600);

      expect(mockRedisClient.setex).toHaveBeenCalledWith(
        'test-key',
        3600,
        JSON.stringify(testObject),
      );
    });

    it('should keep string as-is', async () => {
      mockRedisClient.set.mockResolvedValue('OK');

      await service.set('test-key', 'string-value');

      expect(mockRedisClient.set).toHaveBeenCalledWith(
        'test-key',
        'string-value',
      );
    });
  });

  describe('del', () => {
    it('should delete key', async () => {
      mockRedisClient.del.mockResolvedValue(1);

      await service.del('test-key');

      expect(mockRedisClient.del).toHaveBeenCalledWith('test-key');
    });
  });

  describe('exists', () => {
    it('should return true when key exists', async () => {
      mockRedisClient.exists.mockResolvedValue(1);

      const result = await service.exists('test-key');

      expect(result).toBe(true);
      expect(mockRedisClient.exists).toHaveBeenCalledWith('test-key');
    });

    it('should return false when key does not exist', async () => {
      mockRedisClient.exists.mockResolvedValue(0);

      const result = await service.exists('test-key');

      expect(result).toBe(false);
    });
  });

  describe('keys', () => {
    it('should return array of matching keys', async () => {
      const matchingKeys = ['key1', 'key2', 'key3'];
      mockRedisClient.keys.mockResolvedValue(matchingKeys);

      const result = await service.keys('test:*');

      expect(result).toEqual(matchingKeys);
      expect(mockRedisClient.keys).toHaveBeenCalledWith('test:*');
    });

    it('should return empty array when no keys match', async () => {
      mockRedisClient.keys.mockResolvedValue([]);

      const result = await service.keys('nonexistent:*');

      expect(result).toEqual([]);
    });
  });

  describe('flushAll', () => {
    it('should flush all keys', async () => {
      mockRedisClient.flushall.mockResolvedValue('OK');

      await service.flushAll();

      expect(mockRedisClient.flushall).toHaveBeenCalled();
    });
  });

  describe('getClient', () => {
    it('should return Redis client instance', () => {
      const client = service.getClient();

      expect(client).toBe(mockRedisClient);
    });
  });

  describe('onModuleInit', () => {
    it('should connect to Redis with correct URL', () => {
      expect(Redis).toHaveBeenCalledWith('redis://localhost:6379', {
        retryStrategy: expect.any(Function),
        maxRetriesPerRequest: 3,
      });
    });

    it('should set up event handlers', () => {
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        'connect',
        expect.any(Function),
      );
      expect(mockRedisClient.on).toHaveBeenCalledWith(
        'error',
        expect.any(Function),
      );
    });
  });

  describe('onModuleDestroy', () => {
    it('should quit Redis connection', async () => {
      mockRedisClient.quit.mockResolvedValue('OK');

      await service.onModuleDestroy();

      expect(mockRedisClient.quit).toHaveBeenCalled();
    });
  });
});

