// import {
//   All,
//   Controller,
//   Req,
//   Res,
//   Next,
//   HttpException,
//   HttpStatus,
//   UseGuards,
//   Logger,
// } from '@nestjs/common';
// import { Request, Response, NextFunction } from 'express';
// import { ProxyService } from './proxy.service';
// import { getServiceByPrefix } from '../../config/service-registry';
// import { JwtAuthGuard } from '../auth/jwt-auth.guard';
// import { SkipAuth } from '../auth/skip-auth.decorator';

// const GATEWAY_INTERNAL_ROUTES = ['/notifications', '/auth', '/health'];

// @Controller()
// export class ProxyController {
//   private readonly logger = new Logger(ProxyController.name);

//   constructor(private readonly proxyService: ProxyService) {}

//   /**
//    * Catch-all route handler for proxying requests
//    * This handles ALL HTTP methods (GET, POST, PUT, PATCH, DELETE, etc.)
//    */
//   @All('users/*')
//   @All('templates/*')
//   @All('email/*')
//   @All('push/*')
//   @UseGuards(JwtAuthGuard)
//   async proxyRequest(
//     @Req() req: Request,
//     @Res() res: Response,
//     @Next() next: NextFunction
//   ) {
//     try {
//       const path = req.path;
//       const method = req.method;

//       this.logger.debug(`Incoming request: ${method} ${path}`);

//       if (GATEWAY_INTERNAL_ROUTES.some((prefix) => path.startsWith(prefix))) {
//         this.logger.debug(`Bypassing proxy for internal route: ${path}`);
//         return next(); // let Nest route it to NotificationController, etc.
//       }

//       // Find the target service based on the path
//       const service = getServiceByPrefix(path);

//       if (!service) {
//         throw new HttpException(
//           {
//             success: false,
//             error: 'SERVICE_NOT_FOUND',
//             message: `No service found for path: ${path}`,
//             meta: null,
//           },
//           HttpStatus.NOT_FOUND
//         );
//       }

//       // Check if service requires auth
//       if (service.requiresAuth && !req.user) {
//         throw new HttpException(
//           {
//             success: false,
//             error: 'UNAUTHORIZED',
//             message: 'Authentication required',
//             meta: null,
//           },
//           HttpStatus.UNAUTHORIZED
//         );
//       }

//       // Proxy the request to the target service
//       const response = await this.proxyService.proxyRequest(
//         service,
//         path,
//         method,
//         req.body,
//         req.headers as Record<string, string>,
//         req.query
//       );

//       // Forward the response status and headers
//       res.status(response.status);

//       // Copy response headers
//       Object.entries(response.headers).forEach(([key, value]) => {
//         res.setHeader(key, value as string);
//       });

//       // Send the response body
//       return res.send(response.data);
//     } catch (error) {
//       this.logger.error('Proxy error:', error);

//       if (error instanceof HttpException) {
//         throw error;
//       }

//       // If it's an Axios error with response, forward it
//       if (error.response) {
//         return res.status(error.response.status).send(error.response.data);
//       }

//       // Generic error
//       throw new HttpException(
//         {
//           success: false,
//           error: 'PROXY_ERROR',
//           message: 'Failed to proxy request',
//           meta: null,
//         },
//         HttpStatus.BAD_GATEWAY
//       );
//     }
//   }
// }

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

// Routes that are handled by the gateway itself (not proxied)
const GATEWAY_INTERNAL_ROUTES = [
  '/notifications',
  '/health',
  '/api/notifications',
  '/api/health',
];

// Public routes that don't require authentication
const PUBLIC_ROUTES = [
  '/users/auth/login',
  '/users/auth/register',
  '/api/users/auth/login',
  '/api/users/auth/register',
  '/health',
  '/api/health',
];

@Controller()
export class ProxyController {
  private readonly logger = new Logger(ProxyController.name);

  constructor(private readonly proxyService: ProxyService) {}

  /**
   * Check if a route is public (doesn't require auth)
   */
  private isPublicRoute(path: string): boolean {
    return PUBLIC_ROUTES.some((route) => path.startsWith(route));
  }

  /**
   * Catch-all route handler for proxying requests
   * This handles ALL HTTP methods (GET, POST, PUT, PATCH, DELETE, etc.)
   */
  @All('users/*')
  @All('templates/*')
  @All('email/*')
  @All('push/*')
  @All('api/users/*')
  @All('api/templates/*')
  @All('api/email/*')
  @All('api/push/*')
  @UseGuards(JwtAuthGuard) // Apply guard globally
  async proxyRequest(
    @Req() req: Request,
    @Res() res: Response,
    @Next() next: NextFunction
  ) {
    try {
      const path = req.path;
      const method = req.method;

      this.logger.debug(`Incoming request: ${method} ${path}`);

      // Check if this is an internal gateway route
      if (GATEWAY_INTERNAL_ROUTES.some((prefix) => path.startsWith(prefix))) {
        this.logger.debug(`Bypassing proxy for internal route: ${path}`);
        return next(); // Let Nest route it to NotificationController, etc.
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

      // Check if service requires auth and user is authenticated
      // Note: JwtAuthGuard already handled auth, but we double-check here
      if (service.requiresAuth && !req.user && !this.isPublicRoute(path)) {
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

      // Build headers to forward to service
      const forwardHeaders = { ...req.headers } as Record<string, string>;

      // Add user context to headers for downstream services
      if (req.user) {
        forwardHeaders['X-User-Id'] = req.user.user_id;
        forwardHeaders['X-User-Email'] = req.user.email;
        forwardHeaders['X-User-Name'] = req.user.name;
      }

      // Proxy the request to the target service
      this.logger.log(`Proxying to ${service.name}: ${method} ${path}`);
      const response = await this.proxyService.proxyRequest(
        service,
        path,
        method,
        req.body,
        forwardHeaders,
        req.query
      );

      // Forward the response status and headers
      res.status(response.status);

      // Copy response headers (except hop-by-hop headers)
      const headersToSkip = ['transfer-encoding', 'connection', 'keep-alive'];
      Object.entries(response.headers).forEach(([key, value]) => {
        if (!headersToSkip.includes(key.toLowerCase())) {
          res.setHeader(key, value as string);
        }
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
          message: error.message || 'Failed to proxy request',
          meta: null,
        },
        HttpStatus.BAD_GATEWAY
      );
    }
  }

  /**
   * Handle authentication routes (login/register) without requiring auth
   */
  @All('users/auth/*')
  @All('api/users/auth/*')
  @SkipAuth() // Skip authentication for auth routes
  async handleAuthRoutes(@Req() req: Request, @Res() res: Response) {
    try {
      const path = req.path;
      const method = req.method;

      this.logger.debug(`Auth route: ${method} ${path}`);

      const service = getServiceByPrefix(path);

      if (!service) {
        throw new HttpException(
          {
            success: false,
            error: 'SERVICE_NOT_FOUND',
            message: `Service not found`,
            meta: null,
          },
          HttpStatus.NOT_FOUND
        );
      }

      const response = await this.proxyService.proxyRequest(
        service,
        path,
        method,
        req.body,
        req.headers as Record<string, string>,
        req.query
      );

      res.status(response.status);
      Object.entries(response.headers).forEach(([key, value]) => {
        res.setHeader(key, value as string);
      });

      return res.send(response.data);
    } catch (error) {
      this.logger.error('Auth route error:', error);

      if (error.response) {
        return res.status(error.response.status).send(error.response.data);
      }

      throw new HttpException(
        {
          success: false,
          error: 'AUTH_ERROR',
          message: 'Authentication failed',
          meta: null,
        },
        HttpStatus.BAD_GATEWAY
      );
    }
  }
}
