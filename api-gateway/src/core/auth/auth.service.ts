import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { ConfigService } from '@nestjs/config';

export interface UserPayload {
  user_id: string;
  email: string;
  name: string;
  preferences?: {
    email: boolean;
    push: boolean;
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly userServiceUrl: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService
  ) {
    this.userServiceUrl = this.configService.get<string>(
      'USER_SERVICE_URL',
      'http://localhost:8083'
    );
  }

  /**
   * Validate JWT token by calling User Service
   */
  async validateToken(token: string): Promise<UserPayload> {
    try {
      this.logger.debug('Validating token with User Service');

      const response = await firstValueFrom(
        this.httpService
          .post(`${this.userServiceUrl}/api/v1/auth/validate`, {
            token: token,
          })
          .pipe(
            timeout(5000),
            catchError((error) => {
              this.logger.error('Token validation failed:', error.message);
              throw new UnauthorizedException('Invalid or expired token');
            })
          )
      );

      if (!response.data.success || !response.data.data.valid) {
        throw new UnauthorizedException('Token validation failed');
      }

      return response.data.data;
    } catch (error) {
      this.logger.error('Authentication error:', error.message);

      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Authentication service unavailable');
    }
  }

  /**
   * Extract token from Authorization header
   */
  extractTokenFromHeader(authHeader: string | undefined): string | null {
    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }

  /**
   * Login through User Service (optional - for testing)
   */
  async login(
    email: string,
    password: string
  ): Promise<{ token: string; user: UserPayload }> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .post(`${this.userServiceUrl}/api/v1/auth/login`, {
            email,
            password,
          })
          .pipe(timeout(10000))
      );

      if (!response.data.success) {
        throw new UnauthorizedException('Invalid credentials');
      }

      return response.data.data;
    } catch (error) {
      this.logger.error('Login error:', error.message);
      throw new UnauthorizedException('Login failed');
    }
  }

  /**
   * Register through User Service (optional - for testing)
   */
  async register(userData: {
    name: string;
    email: string;
    password: string;
    push_token?: string;
    preferences?: { email: boolean; push: boolean };
  }): Promise<{ token: string; user: UserPayload }> {
    try {
      const response = await firstValueFrom(
        this.httpService
          .post(`${this.userServiceUrl}/api/v1/users`, userData)
          .pipe(timeout(5000))
      );

      if (!response.data.success) {
        throw new UnauthorizedException('Registration failed');
      }

      return response.data.data;
    } catch (error) {
      this.logger.error('Registration error:', error.message);
      throw error;
    }
  }
}
