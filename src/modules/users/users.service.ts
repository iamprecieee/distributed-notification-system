import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserPreference } from '../../common/types/user-preference.enum';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class UsersService {
  private readonly SALT_ROUNDS = 10;
  private readonly CACHE_TTL = 3600;
  private readonly CACHE_PREFIX = 'user:preferences:';

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectPinoLogger(UsersService.name)
    private readonly logger: PinoLogger,
    private readonly redisService: RedisService,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserResponseDto> {
    this.logger.info({ email: createUserDto.email }, 'Creating new user');

    const existingUser = await this.userRepository.findOne({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      this.logger.warn({ email: createUserDto.email }, 'User already exists');
      throw new ConflictException('User with this email already exists');
    }

    try {
      const password_hash = await bcrypt.hash(
        createUserDto.password,
        this.SALT_ROUNDS,
      );

      const user = this.userRepository.create({
        name: createUserDto.name,
        email: createUserDto.email,
        push_token: createUserDto.push_token || null,
        preferences: createUserDto.preferences,
        password_hash,
      });

      const savedUser = await this.userRepository.save(user);

      // Cache the user preferences
      await this.cacheUserPreferences(savedUser.id, savedUser.preferences);

      this.logger.info({ userId: savedUser.id }, 'User created successfully');

      return new UserResponseDto(savedUser);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { error: errorMessage, email: createUserDto.email },
        'Failed to create user',
      );
      throw new InternalServerErrorException('Failed to create user');
    }
  }

  async findAll(
    page: number = 1,
    limit: number = 10,
  ): Promise<{ users: UserResponseDto[]; total: number }> {
    this.logger.info({ page, limit }, 'Fetching all users');

    const [users, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { created_at: 'DESC' },
    });

    return {
      users: users.map((user) => new UserResponseDto(user)),
      total,
    };
  }

  async findOne(id: string): Promise<UserResponseDto> {
    this.logger.info({ userId: id }, 'Fetching user by ID');

    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      this.logger.warn({ userId: id }, 'User not found');
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return new UserResponseDto(user);
  }

  async findByEmail(email: string): Promise<User | null> {
    this.logger.info({ email }, 'Fetching user by email');

    const user = await this.userRepository.findOne({ where: { email } });

    return user || null;
  }

  async update(
    id: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    this.logger.info({ userId: id }, 'Updating user');

    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      this.logger.warn({ userId: id }, 'User not found for update');
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    try {
      if (updateUserDto.name !== undefined) {
        user.name = updateUserDto.name;
      }

      if (updateUserDto.push_token !== undefined) {
        user.push_token = updateUserDto.push_token || null;
      }

      if (updateUserDto.preferences !== undefined) {
        user.preferences = updateUserDto.preferences;
        // Invalidate cache when preferences are updated
        await this.invalidatePreferencesCache(id);
      }

      const updatedUser = await this.userRepository.save(user);

      // Re-cache the updated preferences
      await this.cacheUserPreferences(updatedUser.id, updatedUser.preferences);

      this.logger.info({ userId: id }, 'User updated successfully');

      return new UserResponseDto(updatedUser);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        { error: errorMessage, userId: id },
        'Failed to update user',
      );
      throw new InternalServerErrorException('Failed to update user');
    }
  }

  async getPreferences(userId: string): Promise<UserPreference> {
    this.logger.info({ userId }, 'Fetching user preferences');

    // Try to get from cache first
    const cachedPreferences = await this.getCachedPreferences(userId);
    if (cachedPreferences) {
      this.logger.info({ userId }, 'Preferences found in cache');
      return cachedPreferences;
    }

    // If not in cache, get from database
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'preferences'],
    });

    if (!user) {
      this.logger.warn({ userId }, 'User not found');
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    // Cache the preferences for future requests
    await this.cacheUserPreferences(userId, user.preferences);

    return user.preferences;
  }

  async remove(id: string): Promise<void> {
    this.logger.info({ userId: id }, 'Deleting user');

    const result = await this.userRepository.delete(id);

    if (result.affected === 0) {
      this.logger.warn({ userId: id }, 'User not found for deletion');
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    // Remove from cache
    await this.invalidatePreferencesCache(id);

    this.logger.info({ userId: id }, 'User deleted successfully');
  }

  async validatePassword(
    email: string,
    password: string,
  ): Promise<User | null> {
    this.logger.info({ email }, 'Validating user password');

    const user = await this.userRepository.findOne({ where: { email } });

    if (!user) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);

    if (!isPasswordValid) {
      this.logger.warn({ email }, 'Invalid password');
      return null;
    }

    return user;
  }

  // Private helper methods for Redis caching
  private async cacheUserPreferences(
    userId: string,
    preferences: UserPreference,
  ): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}${userId}`;
    try {
      await this.redisService.set(
        cacheKey,
        JSON.stringify(preferences),
        this.CACHE_TTL,
      );
      this.logger.info({ userId }, 'User preferences cached');
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        },
        'Failed to cache user preferences',
      );
    }
  }

  private async getCachedPreferences(
    userId: string,
  ): Promise<UserPreference | null> {
    const cacheKey = `${this.CACHE_PREFIX}${userId}`;
    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return JSON.parse(cached) as UserPreference;
      }
      return null;
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        },
        'Failed to get cached preferences',
      );
      return null;
    }
  }

  private async invalidatePreferencesCache(userId: string): Promise<void> {
    const cacheKey = `${this.CACHE_PREFIX}${userId}`;
    try {
      await this.redisService.del(cacheKey);
      this.logger.info({ userId }, 'User preferences cache invalidated');
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        },
        'Failed to invalidate cache',
      );
    }
  }
}
