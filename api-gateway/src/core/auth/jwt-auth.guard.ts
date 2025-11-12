import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { SKIP_AUTH_KEY } from './skip-auth.decorator';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        user_id: string;
        email: string;
        name: string;
        preferences?: {
          email: boolean;
          push: boolean;
        };
      };
    }
  }
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is marked with @SkipAuth()
    const skipAuth = this.reflector.getAllAndOverride<boolean>(SKIP_AUTH_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipAuth) {
      this.logger.debug('Skipping authentication for this route');
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    // Extract token
    const token = this.authService.extractTokenFromHeader(authHeader);

    if (!token) {
      this.logger.warn('No token provided');
      throw new UnauthorizedException({
        success: false,
        error: 'MISSING_TOKEN',
        message: 'Authentication token required',
        meta: null,
      });
    }

    try {
      // Validate token with User Service
      const user = await this.authService.validateToken(token);

      // Attach user to request object
      request.user = user;

      this.logger.debug(`User authenticated: ${user.user_id}`);
      return true;
    } catch (error) {
      this.logger.error('Authentication failed:', error.message);

      throw new UnauthorizedException({
        success: false,
        error: 'INVALID_TOKEN',
        message: error.message || 'Invalid or expired token',
        meta: null,
      });
    }
  }
}
