import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Get,
  UseGuards,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { SkipAuth } from './skip-auth.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ValidateTokenDto } from './dto/validate_token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Login endpoint (proxies to User Service)
   */
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Login user' })
  @Post('login')
  @SkipAuth()
  async login(@Body() body: LoginDto) {
    try {
      const { email, password } = body;

      if (!email || !password) {
        throw new HttpException(
          {
            success: false,
            error: 'INVALID_INPUT',
            message: 'Email and password are required',
            meta: null,
          },
          HttpStatus.BAD_REQUEST
        );
      }

      const result = await this.authService.login(email, password);

      return {
        success: true,
        data: result,
        message: 'Login successful',
        meta: null,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: 'LOGIN_FAILED',
          message: error.message || 'Login failed',
          meta: null,
        },
        error.status || HttpStatus.UNAUTHORIZED
      );
    }
  }

  /**
   * Register endpoint (proxies to User Service)
   */
  @ApiTags('Auth')
  @ApiOperation({ summary: 'Register user' })
  @Post('register')
  @SkipAuth()
  async register(
    @Body()
    body: RegisterDto
  ) {
    try {
      const { name, email, password, push_token, preferences } = body;

      if (!name || !email || !password) {
        throw new HttpException(
          {
            success: false,
            error: 'INVALID_INPUT',
            message: 'Name, email, and password are required',
            meta: null,
          },
          HttpStatus.BAD_REQUEST
        );
      }

      const result = await this.authService.register({
        name,
        email,
        password,
        push_token,
        preferences: preferences || { email: true, push: true },
      });

      return {
        success: true,
        data: result,
        message: 'Registration successful',
        meta: null,
      };
    } catch (error) {
      throw new HttpException(
        {
          success: false,
          error: 'REGISTRATION_FAILED',
          message: error.message || 'Registration failed',
          meta: null,
        },
        error.status || HttpStatus.BAD_REQUEST
      );
    }
  }

  /**
   * Get current user (requires authentication)
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  async getCurrentUser(@Req() req: Request) {
    return {
      success: true,
      data: req.user,
      message: 'User retrieved successfully',
      meta: null,
    };
  }

  /**
   * Validate token endpoint
   */
  @Post('validate')
  @SkipAuth()
  async validateToken(@Body() body: ValidateTokenDto) {
    try {
      const { token } = body;

      if (!token) {
        throw new HttpException(
          {
            success: false,
            error: 'INVALID_INPUT',
            message: 'Token is required',
            meta: null,
          },
          HttpStatus.BAD_REQUEST
        );
      }

      const user = await this.authService.validateToken(token);

      return {
        success: true,
        data: { valid: true, user },
        message: 'Token is valid',
        meta: null,
      };
    } catch (error) {
      return {
        success: false,
        data: { valid: false },
        error: 'INVALID_TOKEN',
        message: error.message || 'Token is invalid',
        meta: null,
      };
    }
  }
}
