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
import { SkipAuth } from '../auth/skip-auth.decorator';

const GATEWAY_INTERNAL_ROUTES = ['/notifications', '/auth', '/health'];

@Controller()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private readonly proxyService: ProxyService) {}

  /**
   * Catch-all route handler for proxying requests
   * This handles ALL HTTP methods (GET, POST, PUT, PATCH, DELETE, etc.)
   */
  @All('users/*')
  @All('templates/*')
  @All('email/*')
  @All('push/*')
  @UseGuards(JwtAuthGuard)
  async proxyRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction
  ) {
    try {
      const path = req.path;
      const method = req.method;

      this.logger.debug(`Incoming request: ${method} ${path}`);

      if (GATEWAY_INTERNAL_ROUTES.some((prefix) => path.startsWith(prefix))) {
        this.logger.debug(`Bypassing proxy for internal route: ${path}`);
        return next(); // let Nest route it to NotificationController, etc.
      }

      // Find the target service based on the path
      const service = getServiceByPrefix(path);

      if (!service) {
        throw new HttpException(
          {
            success: false,
            error: 'SERVICE_NOT_FOUND',
            message: `No service found for path: ${path}`,
            meta: null,
          },
          HttpStatus.NOT_FOUND
        );
      }

      // Check if service requires auth
      if (service.requiresAuth && !req.user) {
        throw new HttpException(
          {
            success: false,
            error: 'UNAUTHORIZED',
            message: 'Authentication required',
            meta: null,
          },
          HttpStatus.UNAUTHORIZED
        );
      }

      // Proxy the request to the target service
      const response = await this.proxyService.proxyRequest(
        service,
        path,
        method,
        req.body,
        req.headers as Record<string, string>,
        req.query
      );

      // Forward the response status and headers
      res.status(response.status);

      // Copy response headers
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value as string);
      });

      // Send the response body
      return res.send(response.data);
    } catch (error) {
      this.logger.error('Proxy error:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      // If it's an Axios error with response, forward it
      if (error.response) {
        return res.status(error.response.status).send(error.response.data);
      }

      // Generic error
      throw new HttpException(
        {
          success: false,
          error: 'PROXY_ERROR',
          message: 'Failed to proxy request',
          meta: null,
        },
        HttpStatus.BAD_GATEWAY
      );
    }
  }
}
