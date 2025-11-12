import { Test, TestingModule } from '@nestjs/testing';
import { TemplatesController } from '../modules/templates/templates.controller';
import { TemplatesService } from '../modules/templates/templates.service';
import { Template } from '../modules/templates/entities/template.entity';
import { TemplateType } from '../modules/templates/enums/template-type.enum';

describe('TemplatesController', () => {
  let controller: TemplatesController;

  const mockTemplate: Template = {
    id: 'test-id',
    code: 'welcome_email',
    type: TemplateType.EMAIL,
    language: 'en',
    version: 1,
    content: {
      subject: 'Welcome {{name}}',
      body: 'Hello {{name}}',
    },
    variables: ['name'],
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockTemplatesService = {
    create: jest.fn(),
    update: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TemplatesController],
      providers: [
        {
          provide: TemplatesService,
          useValue: mockTemplatesService,
        },
      ],
    }).compile();

    controller = module.get<TemplatesController>(TemplatesController);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a template', async () => {
      mockTemplatesService.create.mockResolvedValue(mockTemplate);

      const result = await controller.create({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Welcome {{name}}',
          body: 'Hello {{name}}',
        },
        variables: ['name'],
      });

      expect(result).toEqual(mockTemplate);
      expect(mockTemplatesService.create).toHaveBeenCalledWith({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        content: {
          subject: 'Welcome {{name}}',
          body: 'Hello {{name}}',
        },
        variables: ['name'],
      });
    });
  });

  describe('update', () => {
    it('should update a template', async () => {
      const updatedTemplate: Template = {
        ...mockTemplate,
        version: 2,
      };

      mockTemplatesService.update.mockResolvedValue(updatedTemplate);

      const result = await controller.update('welcome_email', {
        language: 'en',
        content: {
          subject: 'Updated Welcome {{name}}',
        },
      });

      expect(result).toEqual(updatedTemplate);
      expect(mockTemplatesService.update).toHaveBeenCalledWith(
        'welcome_email',
        {
          language: 'en',
          content: {
            subject: 'Updated Welcome {{name}}',
          },
        },
      );
    });
  });

  describe('findOne', () => {
    it('should return a template', async () => {
      mockTemplatesService.findOne.mockResolvedValue(mockTemplate);

      const result = await controller.findOne('welcome_email', {
        lang: 'en',
        version: undefined,
      });

      expect(result).toEqual(mockTemplate);
      expect(mockTemplatesService.findOne).toHaveBeenCalledWith(
        'welcome_email',
        'en',
        undefined,
      );
    });

    it('should use default language when not provided', async () => {
      mockTemplatesService.findOne.mockResolvedValue(mockTemplate);

      await controller.findOne('welcome_email', {
        lang: undefined,
        version: undefined,
      });

      expect(mockTemplatesService.findOne).toHaveBeenCalledWith(
        'welcome_email',
        'en',
        undefined,
      );
    });

    it('should pass version when provided', async () => {
      mockTemplatesService.findOne.mockResolvedValue(mockTemplate);

      await controller.findOne('welcome_email', {
        lang: 'en',
        version: 1,
      });

      expect(mockTemplatesService.findOne).toHaveBeenCalledWith(
        'welcome_email',
        'en',
        1,
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated templates', async () => {
      const paginatedResponse = {
        data: [mockTemplate],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      };

      mockTemplatesService.findAll.mockResolvedValue(paginatedResponse);

      const result = await controller.findAll({
        page: 1,
        limit: 10,
      });

      expect(result).toEqual(paginatedResponse);
      expect(mockTemplatesService.findAll).toHaveBeenCalledWith(1, 10);
    });

    it('should use default pagination when not provided', async () => {
      const paginatedResponse = {
        data: [mockTemplate],
        meta: {
          page: 1,
          limit: 10,
          total: 1,
          totalPages: 1,
        },
      };

      mockTemplatesService.findAll.mockResolvedValue(paginatedResponse);

      await controller.findAll({});

      expect(mockTemplatesService.findAll).toHaveBeenCalledWith(1, 10);
    });
  });

  describe('delete', () => {
    it('should delete a template', async () => {
      mockTemplatesService.delete.mockResolvedValue(undefined);

      await controller.delete('welcome_email', 'en');

      expect(mockTemplatesService.delete).toHaveBeenCalledWith(
        'welcome_email',
        'en',
      );
    });

    it('should use default language when not provided', async () => {
      mockTemplatesService.delete.mockResolvedValue(undefined);

      await controller.delete('welcome_email', undefined);

      expect(mockTemplatesService.delete).toHaveBeenCalledWith(
        'welcome_email',
        'en',
      );
    });
  });
});

