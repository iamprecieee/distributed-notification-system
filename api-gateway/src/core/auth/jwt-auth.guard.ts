import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { SKIP_AUTH_KEY } from './skip-auth.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    // Check if route is marked to skip auth
    const skipAuth = this.reflector.getAllAndOverride<boolean>(SKIP_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipAuth) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();

    // Allow public endpoints
    const publicPaths = [
      '/api/health',
      '/api/docs',
      '/api/auth/login',
      '/api/auth/register',
      '/api/notifications',
    ];
    if (publicPaths.some((path) => request.path.startsWith(path))) {
      return user || {};
    }

    if (err || !user) {
      this.logger.warn(
        `Authentication failed for ${request.path}: ${info?.message}`
      );
      throw (
        err ||
        new UnauthorizedException('Invalid or missing authentication token')
      );
    }

    return user;
  }
}
