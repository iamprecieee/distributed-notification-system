import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users.service';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { RedisService } from '../../redis/redis.service';

// Mock bcrypt
jest.mock('bcrypt');

describe('UsersService', () => {
  let service: UsersService;
  let userRepository: jest.Mocked<Repository<User>>;
  let redisService: jest.Mocked<RedisService>;
  let logger: jest.Mocked<PinoLogger>;

  // Mock data
  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const mockUser: User = {
    id: mockUserId,
    name: 'John Doe',
    email: 'john@example.com',
    push_token: 'token123',
    password_hash: 'hashedPassword123',
    preferences: { email: true, push: true },
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
  };

  const mockCreateUserDto: CreateUserDto = {
    name: 'John Doe',
    email: 'john@example.com',
    push_token: 'token123',
    preferences: { email: true, push: true },
    password: 'password123',
  };

  beforeEach(async () => {
    // Create mocked repository
    const mockRepository = {
      findOne: jest.fn(),
      findAndCount: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    };

    // Create mocked Redis service
    const mockRedis = {
      set: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
    };

    // Create mocked logger
    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
        {
          provide: RedisService,
          useValue: mockRedis,
        },
        {
          provide: `PinoLogger:${UsersService.name}`,
          useValue: mockLogger,
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    userRepository = module.get(getRepositoryToken(User));
    redisService = module.get(RedisService);
    logger = module.get(`PinoLogger:${UsersService.name}`);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should successfully create a new user', async () => {
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword123');
      redisService.set.mockResolvedValue(undefined);

      const result = await service.create(mockCreateUserDto);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: mockCreateUserDto.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(mockCreateUserDto.password, 10);
      expect(userRepository.create).toHaveBeenCalledWith({
        name: mockCreateUserDto.name,
        email: mockCreateUserDto.email,
        push_token: mockCreateUserDto.push_token,
        preferences: mockCreateUserDto.preferences,
        password_hash: 'hashedPassword123',
      });
      expect(userRepository.save).toHaveBeenCalledWith(mockUser);
      expect(redisService.set).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
        JSON.stringify(mockUser.preferences),
        3600,
      );
      expect(result).toEqual(
        expect.objectContaining({
          id: mockUserId,
          name: mockUser.name,
          email: mockUser.email,
        }),
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it('should handle null push_token', async () => {
      const dtoWithoutPushToken = {
        ...mockCreateUserDto,
        push_token: undefined,
      };
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue({ ...mockUser, push_token: null });
      userRepository.save.mockResolvedValue({ ...mockUser, push_token: null });
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword123');
      redisService.set.mockResolvedValue(undefined);

      await service.create(dtoWithoutPushToken);

      expect(userRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          push_token: null,
        }),
      );
    });

    it('should throw ConflictException if user already exists', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      await expect(service.create(mockCreateUserDto)).rejects.toThrow(
        ConflictException,
      );
      await expect(service.create(mockCreateUserDto)).rejects.toThrow(
        'User with this email already exists',
      );
      expect(logger.warn).toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException on database error', async () => {
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockRejectedValue(new Error('Database error'));
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword123');

      await expect(service.create(mockCreateUserDto)).rejects.toThrow(
        InternalServerErrorException,
      );
      await expect(service.create(mockCreateUserDto)).rejects.toThrow(
        'Failed to create user',
      );
      expect(logger.error).toHaveBeenCalled();
    });

    it('should handle redis cache failure gracefully', async () => {
      userRepository.findOne.mockResolvedValue(null);
      userRepository.create.mockReturnValue(mockUser);
      userRepository.save.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword123');
      redisService.set.mockRejectedValue(new Error('Redis error'));

      const result = await service.create(mockCreateUserDto);

      expect(result).toBeDefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Redis error',
        }),
        'Failed to cache user preferences',
      );
    });
  });

  describe('findAll', () => {
    it('should return paginated users', async () => {
      const mockUsers = [mockUser, { ...mockUser, id: 'another-id' }];
      userRepository.findAndCount.mockResolvedValue([mockUsers, 2]);

      const result = await service.findAll(1, 10);

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        order: { created_at: 'DESC' },
      });
      expect(result.users).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(logger.info).toHaveBeenCalledWith(
        { page: 1, limit: 10 },
        'Fetching all users',
      );
    });

    it('should calculate skip correctly for different pages', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll(3, 20);

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        skip: 40,
        take: 20,
        order: { created_at: 'DESC' },
      });
    });

    it('should use default pagination values', async () => {
      userRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll();

      expect(userRepository.findAndCount).toHaveBeenCalledWith({
        skip: 0,
        take: 10,
        order: { created_at: 'DESC' },
      });
    });
  });

  describe('findOne', () => {
    it('should return a user by id', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findOne(mockUserId);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
      expect(result).toEqual(
        expect.objectContaining({
          id: mockUserId,
          email: mockUser.email,
        }),
      );
      expect(logger.info).toHaveBeenCalled();
    });

    it('should throw NotFoundException if user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findOne(mockUserId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.findOne(mockUserId)).rejects.toThrow(
        `User with ID ${mockUserId} not found`,
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('findByEmail', () => {
    it('should return a user by email', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.findByEmail('john@example.com');

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'john@example.com' },
      });
      expect(result).toEqual(mockUser);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should return null if user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    const mockUpdateDto: UpdateUserDto = {
      name: 'Jane Doe',
      push_token: 'newToken',
      preferences: { email: false, push: true },
    };

    it('should successfully update a user', async () => {
      const updatedUser = { ...mockUser, ...mockUpdateDto };
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.save.mockResolvedValue(updatedUser);
      redisService.del.mockResolvedValue(undefined);
      redisService.set.mockResolvedValue(undefined);

      const result = await service.update(mockUserId, mockUpdateDto);

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUserId },
      });
      expect(userRepository.save).toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
      );
      expect(redisService.set).toHaveBeenCalled();
      expect(result.name).toBe(mockUpdateDto.name);
      expect(logger.info).toHaveBeenCalledWith(
        { userId: mockUserId },
        'User updated successfully',
      );
    });

    it('should update only provided fields', async () => {
      const partialUpdate: UpdateUserDto = { name: 'New Name' };
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        name: 'New Name',
      });
      redisService.set.mockResolvedValue(undefined);

      await service.update(mockUserId, partialUpdate);

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Name',
          email: mockUser.email,
          push_token: mockUser.push_token,
        }),
      );
    });

    it('should handle null push_token update', async () => {
      const updateWithNullToken: UpdateUserDto = { push_token: null };
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        push_token: null,
      });
      redisService.set.mockResolvedValue(undefined);

      await service.update(mockUserId, updateWithNullToken);

      expect(userRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          push_token: null,
        }),
      );
    });

    it('should invalidate cache when preferences are updated', async () => {
      const preferencesUpdate: UpdateUserDto = {
        preferences: { email: false, push: false },
      };
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.save.mockResolvedValue({
        ...mockUser,
        preferences: { email: false, push: false },
      });
      redisService.del.mockResolvedValue(undefined);
      redisService.set.mockResolvedValue(undefined);

      await service.update(mockUserId, preferencesUpdate);

      expect(redisService.del).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
      );
      expect(redisService.set).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
        JSON.stringify({ email: false, push: false }),
        3600,
      );
    });

    it('should throw NotFoundException if user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.update(mockUserId, mockUpdateDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(logger.warn).toHaveBeenCalled();
      expect(userRepository.save).not.toHaveBeenCalled();
    });

    it('should throw InternalServerErrorException on save error', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      userRepository.save.mockRejectedValue(new Error('Save failed'));

      await expect(service.update(mockUserId, mockUpdateDto)).rejects.toThrow(
        InternalServerErrorException,
      );
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getPreferences', () => {
    it('should return preferences from cache if available', async () => {
      const cachedPreferences = { email: true, push: false };
      redisService.get.mockResolvedValue(JSON.stringify(cachedPreferences));

      const result = await service.getPreferences(mockUserId);

      expect(redisService.get).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
      );
      expect(result).toEqual(cachedPreferences);
      expect(userRepository.findOne).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { userId: mockUserId },
        'Preferences found in cache',
      );
    });

    it('should fetch from database if not in cache', async () => {
      redisService.get.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(mockUser);
      redisService.set.mockResolvedValue(undefined);

      const result = await service.getPreferences(mockUserId);

      expect(redisService.get).toHaveBeenCalled();
      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockUserId },
        select: ['id', 'preferences'],
      });
      expect(redisService.set).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
        JSON.stringify(mockUser.preferences),
        3600,
      );
      expect(result).toEqual(mockUser.preferences);
    });

    it('should handle cache read errors gracefully', async () => {
      redisService.get.mockRejectedValue(new Error('Redis read error'));
      userRepository.findOne.mockResolvedValue(mockUser);
      redisService.set.mockResolvedValue(undefined);

      const result = await service.getPreferences(mockUserId);

      expect(result).toEqual(mockUser.preferences);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Redis read error',
        }),
        'Failed to get cached preferences',
      );
    });

    it('should throw NotFoundException if user does not exist', async () => {
      redisService.get.mockResolvedValue(null);
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.getPreferences(mockUserId)).rejects.toThrow(
        NotFoundException,
      );
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should successfully delete a user', async () => {
      userRepository.delete.mockResolvedValue({ affected: 1, raw: {} });
      redisService.del.mockResolvedValue(undefined);

      await service.remove(mockUserId);

      expect(userRepository.delete).toHaveBeenCalledWith(mockUserId);
      expect(redisService.del).toHaveBeenCalledWith(
        `user:preferences:${mockUserId}`,
      );
      expect(logger.info).toHaveBeenCalledWith(
        { userId: mockUserId },
        'User deleted successfully',
      );
    });

    it('should throw NotFoundException if user does not exist', async () => {
      userRepository.delete.mockResolvedValue({ affected: 0, raw: {} });

      await expect(service.remove(mockUserId)).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.remove(mockUserId)).rejects.toThrow(
        `User with ID ${mockUserId} not found`,
      );
      expect(logger.warn).toHaveBeenCalled();
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('should handle cache deletion errors gracefully', async () => {
      userRepository.delete.mockResolvedValue({ affected: 1, raw: {} });
      redisService.del.mockRejectedValue(new Error('Redis delete error'));

      await service.remove(mockUserId);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'Redis delete error',
        }),
        'Failed to invalidate cache',
      );
    });
  });

  describe('validatePassword', () => {
    it('should return user if password is valid', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validatePassword(
        'john@example.com',
        'password123',
      );

      expect(userRepository.findOne).toHaveBeenCalledWith({
        where: { email: 'john@example.com' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password123',
        mockUser.password_hash,
      );
      expect(result).toEqual(mockUser);
      expect(logger.info).toHaveBeenCalled();
    });

    it('should return null if user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      const result = await service.validatePassword(
        'nonexistent@example.com',
        'password123',
      );

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should return null if password is invalid', async () => {
      userRepository.findOne.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await service.validatePassword(
        'john@example.com',
        'wrongpassword',
      );

      expect(result).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        { email: 'john@example.com' },
        'Invalid password',
      );
    });
  });
});
