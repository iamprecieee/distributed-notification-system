import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TemplatesRepository } from '../modules/templates/templates.repository';
import { Template } from '../modules/templates/entities/template.entity';
import { TemplateType } from '../modules/templates/enums/template-type.enum';

describe('TemplatesRepository', () => {
  let repository: TemplatesRepository;

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

  const mockQueryBuilder = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn(),
    select: jest.fn().mockReturnThis(),
    getRawOne: jest.fn(),
  };

  const mockTypeOrmRepository = {
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    findAndCount: jest.fn(),
    count: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TemplatesRepository,
        {
          provide: getRepositoryToken(Template),
          useValue: mockTypeOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<TemplatesRepository>(TemplatesRepository);

    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create and save a template', async () => {
      mockTypeOrmRepository.create.mockReturnValue(mockTemplate);
      mockTypeOrmRepository.save.mockResolvedValue(mockTemplate);

      const result = await repository.create({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        version: 1,
        content: {
          subject: 'Welcome {{name}}',
        },
        variables: ['name'],
      });

      expect(result).toEqual(mockTemplate);
      expect(mockTypeOrmRepository.create).toHaveBeenCalledWith({
        code: 'welcome_email',
        type: TemplateType.EMAIL,
        language: 'en',
        version: 1,
        content: {
          subject: 'Welcome {{name}}',
        },
        variables: ['name'],
      });
      expect(mockTypeOrmRepository.save).toHaveBeenCalledWith(mockTemplate);
    });
  });

  describe('findByCodeAndLanguage', () => {
    it('should find template by code and language', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(mockTemplate);

      const result = await repository.findByCodeAndLanguage(
        'welcome_email',
        'en',
      );

      expect(result).toEqual(mockTemplate);
      expect(mockTypeOrmRepository.createQueryBuilder).toHaveBeenCalledWith(
        'template',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'template.code = :code',
        { code: 'welcome_email' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'template.language = :language',
        { language: 'en' },
      );
      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'template.version',
        'DESC',
      );
    });

    it('should find template by code, language and version', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(mockTemplate);

      const result = await repository.findByCodeAndLanguage(
        'welcome_email',
        'en',
        1,
      );

      expect(result).toEqual(mockTemplate);
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'template.version = :version',
        { version: 1 },
      );
      expect(mockQueryBuilder.orderBy).not.toHaveBeenCalled();
    });

    it('should return null when template not found', async () => {
      mockQueryBuilder.getOne.mockResolvedValue(null);

      const result = await repository.findByCodeAndLanguage(
        'nonexistent',
        'en',
      );

      expect(result).toBeNull();
    });
  });

  describe('findLatestVersion', () => {
    it('should return latest version number', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: 5 });

      const result = await repository.findLatestVersion('welcome_email', 'en');

      expect(result).toBe(5);
      expect(mockQueryBuilder.select).toHaveBeenCalledWith(
        'MAX(template.version)',
        'max',
      );
      expect(mockQueryBuilder.where).toHaveBeenCalledWith(
        'template.code = :code',
        { code: 'welcome_email' },
      );
      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'template.language = :language',
        { language: 'en' },
      );
    });

    it('should return 0 when no versions exist', async () => {
      mockQueryBuilder.getRawOne.mockResolvedValue({ max: null });

      const result = await repository.findLatestVersion('welcome_email', 'en');

      expect(result).toBe(0);
    });
  });

  describe('findAll', () => {
    it('should return paginated templates', async () => {
      const templates = [mockTemplate];
      mockTypeOrmRepository.findAndCount.mockResolvedValue([templates, 1]);

      const result = await repository.findAll(1, 10);

      expect(result).toEqual([templates, 1]);
      expect(mockTypeOrmRepository.findAndCount).toHaveBeenCalledWith({
        take: 10,
        skip: 0,
        order: { created_at: 'DESC' },
      });
    });

    it('should calculate skip correctly for pagination', async () => {
      const templates = [mockTemplate];
      mockTypeOrmRepository.findAndCount.mockResolvedValue([templates, 1]);

      await repository.findAll(2, 10);

      expect(mockTypeOrmRepository.findAndCount).toHaveBeenCalledWith({
        take: 10,
        skip: 10,
        order: { created_at: 'DESC' },
      });
    });

    it('should handle empty results', async () => {
      mockTypeOrmRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await repository.findAll(1, 10);

      expect(result).toEqual([[], 0]);
    });
  });

  describe('exists', () => {
    it('should return true when template exists', async () => {
      mockTypeOrmRepository.count.mockResolvedValue(1);

      const result = await repository.exists('welcome_email', 'en');

      expect(result).toBe(true);
      expect(mockTypeOrmRepository.count).toHaveBeenCalledWith({
        where: { code: 'welcome_email', language: 'en' },
      });
    });

    it('should return false when template does not exist', async () => {
      mockTypeOrmRepository.count.mockResolvedValue(0);

      const result = await repository.exists('nonexistent', 'en');

      expect(result).toBe(false);
    });
  });
});

