import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Request } from 'express';
import { RedisService } from '../../infrastructure/redis/redis.service';

@Injectable()
export class IdempotencyGuard implements CanActivate {
  constructor(private readonly redisService: RedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const idempotencyKey = request.headers['x-idempotency-key'] as string;

    if (!idempotencyKey) {
      throw new BadRequestException(
        'x-idempotency-key header is required for this endpoint'
      );
    }

    // Check if this idempotency key was already used
    const redisKey = `idempotency:${idempotencyKey}`;
    const exists = await this.redisService.get(redisKey);

    if (exists) {
      throw new ConflictException(
        'Duplicate request detected. This idempotency key has already been used.'
      );
    }

    // Store idempotency key for 24 hours
    await this.redisService.set(redisKey, '1', 86400);

    return true;
  }
}
