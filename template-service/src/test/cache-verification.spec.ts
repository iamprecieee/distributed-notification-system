import { Test, TestingModule } from '@nestjs/testing';
import { TemplatesService } from '../modules/templates/templates.service';
import { TemplatesRepository } from '../modules/templates/templates.repository';
import { RedisService } from '../common/redis/redis.service';
import { RabbitMQService } from '../common/messaging/rabbitmq.service';
import { Template } from '../modules/templates/entities/template.entity';
import { TemplateType } from '../modules/templates/enums/template-type.enum';

describe('Cache Verification', () => {
  let service: TemplatesService;

  const mockTemplate: Template = {
    id: 'test-id',
    code: 'cache_test',
    type: TemplateType.PUSH,
    language: 'en',
    version: 1,
    content: {
      title: 'Test {{name}}',
      body: 'Hello {{name}}',
    },
    variables: ['name'],
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(),
  };

  const mockRepository = {
    create: jest.fn(),
    findByCodeAndLanguage: jest.fn(),
    exists: jest.fn(),
    findAll: jest.fn(),
  };

  const mockRabbitMQService = {
    publishTemplateUpdated: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesService,
        {
          provide: TemplatesRepository,
          useValue: mockRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
      ],
    }).compile();

    service = module.get<TemplatesService>(TemplatesService);

    jest.clearAllMocks();
  });

  describe('Cache behavior on CREATE', () => {
    it('should cache template after creation', async () => {
      mockRepository.exists.mockResolvedValue(false);
      mockRepository.create.mockResolvedValue(mockTemplate);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      await service.create({
        code: 'cache_test',
        type: TemplateType.PUSH,
        language: 'en',
        content: {
          title: 'Test {{name}}',
          body: 'Hello {{name}}',
        },
        variables: ['name'],
      });

      expect(mockRedisService.set).toHaveBeenCalledTimes(2);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'template:cache_test:en:latest',
        mockTemplate,
        3600,
      );
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'template:cache_test:en:1',
        mockTemplate,
        3600,
      );
      expect(mockRabbitMQService.publishTemplateUpdated).toHaveBeenCalledWith(
        'cache_test',
        1,
      );
    });
  });

  describe('Cache behavior on GET', () => {
    it('should return cached template on cache hit', async () => {
      mockRedisService.get.mockResolvedValue(mockTemplate);

      const result = await service.findOne('cache_test', 'en');

      expect(result).toEqual(mockTemplate);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        'template:cache_test:en:latest',
      );
      expect(mockRepository.findByCodeAndLanguage).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache on cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);

      const result = await service.findOne('cache_test', 'en');

      expect(result).toEqual(mockTemplate);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        'template:cache_test:en:latest',
      );
      expect(mockRepository.findByCodeAndLanguage).toHaveBeenCalledWith(
        'cache_test',
        'en',
        undefined,
      );
      expect(mockRedisService.set).toHaveBeenCalledTimes(2);
    });

    it('should cache both latest and versioned keys', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);

      await service.findOne('cache_test', 'en', 1);

      expect(mockRedisService.set).toHaveBeenCalledWith(
        'template:cache_test:en:latest',
        mockTemplate,
        3600,
      );
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'template:cache_test:en:1',
        mockTemplate,
        3600,
      );
    });
  });

  describe('Cache behavior on UPDATE', () => {
    it('should invalidate cache and set new cache on update', async () => {
      const updatedTemplate: Template = {
        ...mockTemplate,
        version: 2,
        content: {
          title: 'Updated {{name}}',
          body: 'Hi {{name}}',
        },
      };

      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRepository.create.mockResolvedValue(updatedTemplate);
      mockRedisService.keys.mockResolvedValue([
        'template:cache_test:en:latest',
        'template:cache_test:en:1',
      ]);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      await service.update('cache_test', {
        language: 'en',
        content: {
          title: 'Updated {{name}}',
          body: 'Hi {{name}}',
        },
      });

      expect(mockRedisService.keys).toHaveBeenCalledWith(
        'template:cache_test:en:*',
      );
      expect(mockRedisService.del).toHaveBeenCalledTimes(2);
      expect(mockRedisService.set).toHaveBeenCalledTimes(2);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'template:cache_test:en:latest',
        updatedTemplate,
        3600,
      );
      expect(mockRedisService.set).toHaveBeenCalledWith(
        'template:cache_test:en:2',
        updatedTemplate,
        3600,
      );
    });

    it('should handle cache invalidation when no keys exist', async () => {
      const updatedTemplate: Template = {
        ...mockTemplate,
        version: 2,
      };

      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRepository.create.mockResolvedValue(updatedTemplate);
      mockRedisService.keys.mockResolvedValue([]);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      await service.update('cache_test', {
        language: 'en',
        content: mockTemplate.content,
      });

      expect(mockRedisService.del).not.toHaveBeenCalled();
      expect(mockRedisService.set).toHaveBeenCalledTimes(2);
    });
  });

  describe('Cache behavior on DELETE', () => {
    it('should invalidate cache on delete', async () => {
      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRedisService.keys.mockResolvedValue([
        'template:cache_test:en:latest',
        'template:cache_test:en:1',
      ]);

      await service.delete('cache_test', 'en');

      expect(mockRedisService.keys).toHaveBeenCalledWith(
        'template:cache_test:en:*',
      );
      expect(mockRedisService.del).toHaveBeenCalledTimes(2);
    });
  });
});
