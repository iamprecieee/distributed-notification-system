import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { UsersService } from '../../users/users.service';
import { RedisService } from '../../redis/redis.service';

export interface JwtPayload {
  sub: string;
  email: string;
  jti: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly BLACKLIST_PREFIX = 'blacklist:';

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
    @InjectPinoLogger(JwtStrategy.name)
    private readonly logger: PinoLogger,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.secret') as string,
    });
  }

  async validate(payload: JwtPayload) {
    this.logger.info({ userId: payload.sub }, 'Validating JWT token');

    const isBlacklisted = await this.redisService.exists(
      `${this.BLACKLIST_PREFIX}${payload.jti}`,
    );

    if (isBlacklisted) {
      this.logger.warn({ userId: payload.sub }, 'Token is blacklisted');
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.usersService.findByEmail(payload.email);

    if (!user) {
      this.logger.warn({ email: payload.email }, 'User not found');
      throw new UnauthorizedException('User not found');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      jti: payload.jti,
    };
  }
}
