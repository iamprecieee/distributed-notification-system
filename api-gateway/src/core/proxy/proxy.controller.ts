import {
  All,
  Controller,
  Req,
  Res,
  Next,
  HttpException,
  HttpStatus,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ProxyService } from './proxy.service';
import { getServiceByPrefix } from '../../config/service-registry';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ApiBearerAuth, ApiExcludeController } from '@nestjs/swagger';

@Controller()
@ApiExcludeController()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private readonly proxyService: ProxyService) {}

  private isPublicRoute(path: string): boolean {
    return ['/auth/login', '/users/'].some((route) => path.startsWith(route));
  }

  /**
   * Proxy service routes only - specific patterns to avoid conflicts
   */
  @All(['/users*', '/templates*'])
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT')
  async proxyRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction
  ) {
    try {
      // Get the full path including /api prefix if present
      const fullPath = req.path;
      // Strip /api prefix for service matching
      const path = fullPath.replace(/^\/api/, '').replace(/\/$/, '');
      const method = req.method;

      this.logger.debug(`Proxying request: ${method} ${fullPath} -> ${path}`);

      const service = getServiceByPrefix(path);
      if (!service) {
        this.logger.error(`No service found for path: ${path}`);
        throw new HttpException(
          {
            success: false,
            error: 'SERVICE_NOT_FOUND',
            message: `No service configured for path ${path}`,
          },
          HttpStatus.NOT_FOUND
        );
      }

      this.logger.debug(`Matched service: ${service.name} (${service.url})`);

      if (service.requiresAuth && !req.user && !this.isPublicRoute(path)) {
        throw new HttpException(
          {
            success: false,
            error: 'UNAUTHORIZED',
            message: 'Authentication required',
          },
          HttpStatus.UNAUTHORIZED
        );
      }

      // Forward headers
      const forwardHeaders = { ...req.headers } as Record<string, string>;
      if (req.user) {
        forwardHeaders['X-User-Id'] = req.user.user_id;
        forwardHeaders['X-User-Email'] = req.user.email;
        forwardHeaders['X-User-Name'] = req.user.name;
      }

      const response = await this.proxyService.proxyRequest(
        service,
        path,
        method,
        req.body,
        forwardHeaders,
        req.query
      );

      res.status(response.status);
      const skipHeaders = ['transfer-encoding', 'connection', 'keep-alive'];
      Object.entries(response.headers).forEach(([key, value]) => {
        if (!skipHeaders.includes(key.toLowerCase()))
          res.setHeader(key, value as string);
      });

      return res.send(response.data);
    } catch (error) {
      this.logger.error('Proxy error:', error);
      if (error instanceof HttpException) throw error;
      if (error.response)
        return res.status(error.response.status).send(error.response.data);

      throw new HttpException(
        {
          success: false,
          error: 'PROXY_ERROR',
          message: error.message || 'Failed to proxy request',
        },
        HttpStatus.BAD_GATEWAY
      );
    }
  }
}
