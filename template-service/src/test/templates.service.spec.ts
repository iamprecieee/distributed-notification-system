import { Test, TestingModule } from '@nestjs/testing';
import { TemplatesService } from '../modules/templates/templates.service';
import { TemplatesRepository } from '../modules/templates/templates.repository';
import { RedisService } from '../common/redis/redis.service';
import { RabbitMQService } from '../common/messaging/rabbitmq.service';
import { Template } from '../modules/templates/entities/template.entity';
import { TemplateType } from '../modules/templates/enums/template-type.enum';
import {
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';

describe('TemplatesService', () => {
  let service: TemplatesService;

  const mockTemplate: Template = {
    id: 'test-id',
    code: 'welcome_email',
    type: TemplateType.EMAIL,
    language: 'en',
    version: 1,
    content: {
      subject: 'Welcome {{name}}',
      body: 'Hello {{name}}, your code is {{code}}',
    },
    variables: ['name', 'code'],
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

  describe('create', () => {
    it('should create a template successfully', async () => {
      mockRepository.exists.mockResolvedValue(false);
      mockRepository.create.mockResolvedValue(mockTemplate);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      const result = await service.create({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Welcome {{name}}',
          body: 'Hello {{name}}, your code is {{code}}',
        },
        variables: ['name', 'code'],
      });

      expect(result).toEqual(mockTemplate);
      expect(mockRepository.exists).toHaveBeenCalledWith('welcome_email', 'en');
      expect(mockRepository.create).toHaveBeenCalledWith({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Welcome {{name}}',
          body: 'Hello {{name}}, your code is {{code}}',
        },
        variables: ['name', 'code'],
        version: 1,
      });
      expect(mockRedisService.set).toHaveBeenCalledTimes(2);
      expect(mockRabbitMQService.publishTemplateUpdated).toHaveBeenCalledWith(
        'welcome_email',
        1,
      );
    });

    it('should throw BadRequestException when template already exists', async () => {
      mockRepository.exists.mockResolvedValue(true);

      await expect(
        service.create({
          code: 'welcome_email',
          type: TemplateType.EMAIL,
          language: 'en',
          content: { subject: 'Test' },
          variables: [],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when variables are missing', async () => {
      mockRepository.exists.mockResolvedValue(false);

      await expect(
        service.create({
          code: 'welcome_email',
          type: TemplateType.EMAIL,
          language: 'en',
          content: {
            subject: 'Welcome {{name}}',
            body: 'Hello {{name}}, your code is {{code}}',
          },
          variables: ['name'],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockRepository.create).not.toHaveBeenCalled();
    });

    it('should allow unused variables with warning', async () => {
      mockRepository.exists.mockResolvedValue(false);
      mockRepository.create.mockResolvedValue(mockTemplate);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      await service.create({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Welcome {{name}}',
        },
        variables: ['name', 'unused'],
      });

      expect(mockRepository.create).toHaveBeenCalled();
    });

    it('should handle event publishing failure gracefully', async () => {
      mockRepository.exists.mockResolvedValue(false);
      mockRepository.create.mockResolvedValue(mockTemplate);
      mockRabbitMQService.publishTemplateUpdated.mockRejectedValue(
        new Error('RabbitMQ error'),
      );

      const result = await service.create({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: { subject: 'Test' },
        variables: [],
      });

      expect(result).toEqual(mockTemplate);
    });
  });

  describe('update', () => {
    it('should update template and create new version', async () => {
      const updatedTemplate: Template = {
        ...mockTemplate,
        version: 2,
        content: {
          subject: 'Updated Welcome {{name}}',
          body: 'Hi {{name}}',
        },
      };

      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRepository.create.mockResolvedValue(updatedTemplate);
      mockRedisService.keys.mockResolvedValue([
        'template:welcome_email:en:latest',
        'template:welcome_email:en:1',
      ]);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      const result = await service.update('welcome_email', {
        language: 'en',
        content: {
          subject: 'Updated Welcome {{name}}',
          body: 'Hi {{name}}',
        },
        variables: ['name'],
      });

      expect(result).toEqual(updatedTemplate);
      expect(mockRepository.create).toHaveBeenCalledWith({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Updated Welcome {{name}}',
          body: 'Hi {{name}}',
        },
        variables: ['name'],
        version: 2,
      });
      expect(mockRedisService.keys).toHaveBeenCalledWith(
        'template:welcome_email:en:*',
      );
      expect(mockRedisService.del).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when template not found', async () => {
      mockRepository.findByCodeAndLanguage.mockResolvedValue(null);

      await expect(
        service.update('nonexistent', {
          language: 'en',
          content: { subject: 'Test' },
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should use default language when not provided', async () => {
      const updatedTemplate: Template = {
        ...mockTemplate,
        version: 2,
      };

      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRepository.create.mockResolvedValue(updatedTemplate);
      mockRedisService.keys.mockResolvedValue([]);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      await service.update('welcome_email', {
        content: mockTemplate.content,
        variables: mockTemplate.variables,
      });

      expect(mockRepository.findByCodeAndLanguage).toHaveBeenCalledWith(
        'welcome_email',
        'en',
      );
    });

    it('should replace content when content is provided', async () => {
      const updatedTemplate: Template = {
        ...mockTemplate,
        version: 2,
        content: {
          subject: 'Updated Subject',
        },
      };

      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRepository.create.mockResolvedValue(updatedTemplate);
      mockRedisService.keys.mockResolvedValue([]);
      mockRabbitMQService.publishTemplateUpdated.mockResolvedValue(undefined);

      await service.update('welcome_email', {
        language: 'en',
        content: {
          subject: 'Updated Subject',
        },
        variables: ['name'],
      });

      expect(mockRepository.create).toHaveBeenCalledWith({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Updated Subject',
        },
        variables: ['name'],
        version: 2,
      });
    });
  });

  describe('findOne', () => {
    it('should return template from cache on cache hit', async () => {
      mockRedisService.get.mockResolvedValue(mockTemplate);

      const result = await service.findOne('welcome_email', 'en');

      expect(result).toEqual(mockTemplate);
      expect(mockRedisService.get).toHaveBeenCalledWith(
        'template:welcome_email:en:latest',
      );
      expect(mockRepository.findByCodeAndLanguage).not.toHaveBeenCalled();
    });

    it('should fetch from DB and cache on cache miss', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);

      const result = await service.findOne('welcome_email', 'en');

      expect(result).toEqual(mockTemplate);
      expect(mockRepository.findByCodeAndLanguage).toHaveBeenCalledWith(
        'welcome_email',
        'en',
        undefined,
      );
      expect(mockRedisService.set).toHaveBeenCalledTimes(2);
    });

    it('should fetch specific version when provided', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);

      await service.findOne('welcome_email', 'en', 1);

      expect(mockRepository.findByCodeAndLanguage).toHaveBeenCalledWith(
        'welcome_email',
        'en',
        1,
      );
      expect(mockRedisService.get).toHaveBeenCalledWith(
        'template:welcome_email:en:1',
      );
    });

    it('should throw NotFoundException when template not found', async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRepository.findByCodeAndLanguage.mockResolvedValue(null);

      await expect(
        service.findOne('nonexistent', 'en'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should return paginated templates', async () => {
      const templates = [mockTemplate];
      mockRepository.findAll.mockResolvedValue([templates, 1]);

      const result = await service.findAll(1, 10);

      expect(result).toEqual({
        data: templates,
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      });
      expect(mockRepository.findAll).toHaveBeenCalledWith(1, 10);
    });

    it('should calculate total pages correctly', async () => {
      const templates = Array(10).fill(mockTemplate);
      mockRepository.findAll.mockResolvedValue([templates, 25]);

      const result = await service.findAll(1, 10);

      expect(result.meta.totalPages).toBe(3);
    });
  });

  describe('delete', () => {
    it('should delete template and invalidate cache', async () => {
      mockRepository.findByCodeAndLanguage.mockResolvedValue(mockTemplate);
      mockRedisService.keys.mockResolvedValue([
        'template:welcome_email:en:latest',
        'template:welcome_email:en:1',
      ]);

      await service.delete('welcome_email', 'en');

      expect(mockRepository.findByCodeAndLanguage).toHaveBeenCalledWith(
        'welcome_email',
        'en',
      );
      expect(mockRedisService.keys).toHaveBeenCalledWith(
        'template:welcome_email:en:*',
      );
      expect(mockRedisService.del).toHaveBeenCalledTimes(2);
    });

    it('should throw NotFoundException when template not found', async () => {
      mockRepository.findByCodeAndLanguage.mockResolvedValue(null);

      await expect(
        service.delete('nonexistent', 'en'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

