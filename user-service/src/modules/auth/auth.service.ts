import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid';
import { UsersService } from '../users/users.service';
import { RedisService } from '../redis/redis.service';
import { LoginDto } from './dto/login.dto';
import { AuthResponseDto } from './dto/auth-response.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService {
  private readonly ACCESS_TOKEN_EXPIRY = '15m';
  private readonly REFRESH_TOKEN_EXPIRY = '7d';
  private readonly REFRESH_TOKEN_TTL = 7 * 24 * 60 * 60;
  private readonly REFRESH_TOKEN_PREFIX = 'refresh_token:';
  private readonly BLACKLIST_PREFIX = 'blacklist:';

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    @InjectPinoLogger(AuthService.name)
    private readonly logger: PinoLogger,
  ) {}

  async login(loginDto: LoginDto): Promise<AuthResponseDto> {
    this.logger.info({ email: loginDto.email }, 'User login attempt');

    const user = await this.usersService.validatePassword(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      this.logger.warn({ email: loginDto.email }, 'Invalid credentials');
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    this.logger.info({ userId: user.id }, 'User logged in successfully');

    return {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: 'Bearer',
      expires_in: 15 * 60,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    };
  }

  async refresh(refreshTokenDto: RefreshTokenDto): Promise<AuthResponseDto> {
    this.logger.info('Refresh token request');

    try {
      // Verify the refresh token
      const payload: JwtPayload = this.jwtService.verify(
        refreshTokenDto.refresh_token,
        {
          secret: this.configService.get<string>('jwt.secret'),
        },
      );

      // Check if refresh token exists in Redis
      const storedToken = await this.redisService.get(
        `${this.REFRESH_TOKEN_PREFIX}${payload.sub}:${payload.jti}`,
      );

      if (!storedToken) {
        this.logger.warn(
          { userId: payload.sub },
          'Refresh token not found in store',
        );
        throw new UnauthorizedException('Invalid refresh token');
      }

      // Check if token is blacklisted
      const isBlacklisted = await this.redisService.exists(
        `${this.BLACKLIST_PREFIX}${payload.jti}`,
      );

      if (isBlacklisted) {
        this.logger.warn(
          { userId: payload.sub },
          'Refresh token is blacklisted',
        );
        throw new UnauthorizedException('Refresh token has been revoked');
      }

      // Get user to verify they still exist
      const user = await this.usersService.findOne(payload.sub);

      if (!user) {
        this.logger.warn(
          { userId: payload.sub },
          'User not found during refresh',
        );
        throw new UnauthorizedException('User no longer exists');
      }

      // Generate new tokens
      const tokens = await this.generateTokens(payload.sub, payload.email);

      // Invalidate old refresh token
      await this.revokeRefreshToken(payload.jti, payload.sub);

      this.logger.info(
        { userId: payload.sub },
        'Tokens refreshed successfully',
      );

      return {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_type: 'Bearer',
        expires_in: 15 * 60,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
      };
    } catch (error) {
      this.logger.error(
        { error: error instanceof Error ? error.message : 'Unknown error' },
        'Refresh token validation failed',
      );
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  async logout(userId: string, tokenId: string): Promise<void> {
    this.logger.info({ userId }, 'User logout');

    try {
      // Blacklist the current access token
      const accessTokenTTL = 15 * 60;
      await this.redisService.set(
        `${this.BLACKLIST_PREFIX}${tokenId}`,
        'true',
        accessTokenTTL,
      );

      // Revoke all refresh tokens for this user
      await this.revokeAllUserRefreshTokens(userId);

      this.logger.info({ userId }, 'User logged out successfully');
    } catch (error) {
      this.logger.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          userId,
        },
        'Logout failed',
      );
      throw new InternalServerErrorException('Logout failed');
    }
  }

  async validateToken(token: string): Promise<boolean> {
    try {
      const payload: JwtPayload = this.jwtService.verify(token);

      // Check if token is blacklisted
      const isBlacklisted = await this.redisService.exists(
        `${this.BLACKLIST_PREFIX}${payload.jti}`,
      );

      return !isBlacklisted;
    } catch {
      return false;
    }
  }

  private async generateTokens(
    userId: string,
    email: string,
  ): Promise<{ access_token: string; refresh_token: string }> {
    const accessTokenId = uuidv4();
    const refreshTokenId = uuidv4();

    const accessTokenPayload = {
      sub: userId,
      email,
      jti: accessTokenId,
    };

    const refreshTokenPayload = {
      sub: userId,
      email,
      jti: refreshTokenId,
    };

    const access_token = this.jwtService.sign(accessTokenPayload, {
      expiresIn: this.ACCESS_TOKEN_EXPIRY,
    });

    const refresh_token = this.jwtService.sign(refreshTokenPayload, {
      expiresIn: this.REFRESH_TOKEN_EXPIRY,
    });

    // Store refresh token in Redis
    await this.redisService.set(
      `${this.REFRESH_TOKEN_PREFIX}${userId}:${refreshTokenId}`,
      refresh_token,
      this.REFRESH_TOKEN_TTL,
    );

    return { access_token, refresh_token };
  }

  private async revokeRefreshToken(
    tokenId: string,
    userId: string,
  ): Promise<void> {
    await this.redisService.del(
      `${this.REFRESH_TOKEN_PREFIX}${userId}:${tokenId}`,
    );

    // Add to blacklist
    await this.redisService.set(
      `${this.BLACKLIST_PREFIX}${tokenId}`,
      'true',
      this.REFRESH_TOKEN_TTL,
    );
  }

  private async revokeAllUserRefreshTokens(userId: string): Promise<void> {
    const pattern = `${this.REFRESH_TOKEN_PREFIX}${userId}:*`;
    const client = this.redisService.getClient();

    const keys = await client.keys(pattern);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => this.redisService.del(key)));
    }
  }
}
