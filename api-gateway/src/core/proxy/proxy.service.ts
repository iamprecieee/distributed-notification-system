import {
  Injectable,
  Logger,
  BadGatewayException,
  RequestTimeoutException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout, catchError } from 'rxjs';
import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { ServiceConfig } from '../../config/service-registry';

@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Proxy request to target service
   */
  async proxyRequest(
    service: ServiceConfig,
    path: string,
    method: string,
    body?: any,
    headers?: Record<string, string>,
    query?: any
  ): Promise<AxiosResponse> {
    const targetUrl = this.buildTargetUrl(service, path);
    const requestConfig = this.buildRequestConfig(
      method,
      body,
      headers,
      query,
      service
    );

    this.logger.log(`Proxying ${method} ${path} → ${targetUrl}`);

    try {
      const response$ = this.httpService
        .request({
          url: targetUrl,
          ...requestConfig,
        })
        .pipe(
          timeout(service.timeout || 30000),
          catchError((error: AxiosError) => {
            throw this.handleProxyError(error, service.name, targetUrl);
          })
        );

      return await firstValueFrom(response$);
    } catch (error) {
      this.logger.error(`Proxy error for ${service.name}:`, error.message);
      throw error;
    }
  }

  /**
   * Build target URL by removing API prefix and service prefix
   */
  private buildTargetUrl(service: ServiceConfig, path: string): string {
    // Remove /api prefix if exists
    let cleanPath = path.replace(/^\/api/, '');

    // Remove service prefix to get the actual endpoint path
    // Example: /users/123 → /123, then target becomes http://user-service:3001/api/users/123
    if (cleanPath.startsWith(service.prefix)) {
      cleanPath = cleanPath.substring(service.prefix.length);
    }

    // Most microservices have /api prefix internally
    const targetPath = `/api${service.prefix}${cleanPath}`;

    return `${service.url}${targetPath}`;
  }

  /**
   * Build request configuration
   */
  private buildRequestConfig(
    method: string,
    body: any,
    headers: Record<string, string>,
    query: any,
    service: ServiceConfig
  ): AxiosRequestConfig {
    // Filter out hop-by-hop headers
    const filteredHeaders = this.filterHeaders(headers);

    return {
      method: method as any,
      data: body,
      headers: {
        ...filteredHeaders,
        'X-Forwarded-By': 'api-gateway',
        'X-Service-Name': service.name,
      },
      params: query,
      // Don't throw on any status code
      validateStatus: () => true,
    };
  }

  /**
   * Filter out hop-by-hop headers that shouldn't be proxied
   */
  private filterHeaders(
    headers: Record<string, string>
  ): Record<string, string> {
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
      'host',
      'content-length',
    ];

    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers || {})) {
      if (!hopByHopHeaders.includes(key.toLowerCase())) {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * Handle proxy errors
   */
  private handleProxyError(
    error: AxiosError,
    serviceName: string,
    targetUrl: string
  ): Error {
    if (error.code === 'ECONNREFUSED') {
      this.logger.error(
        `Service ${serviceName} is unreachable at ${targetUrl}`
      );
      return new BadGatewayException(
        `Service ${serviceName} is currently unavailable`
      );
    }

    if (error.code === 'ETIMEDOUT' || error.name === 'TimeoutError') {
      this.logger.error(`Request to ${serviceName} timed out`);
      return new RequestTimeoutException(`Request to ${serviceName} timed out`);
    }

    if (error.response) {
      // Service responded with error status
      return error as any;
    }

    // Unknown error
    this.logger.error(`Unknown proxy error for ${serviceName}:`, error);
    return new BadGatewayException(`Failed to communicate with ${serviceName}`);
  }

  /**
   * Health check for a service
   */
  async checkServiceHealth(service: ServiceConfig): Promise<boolean> {
    if (!service.healthCheck) {
      return true; // Assume healthy if no health check endpoint
    }

    try {
      const healthUrl = `${service.url}${service.healthCheck}`;
      const response = await firstValueFrom(
        this.httpService.get(healthUrl).pipe(timeout(3000))
      );

      return response.status >= 200 && response.status < 300;
    } catch (error) {
      this.logger.warn(`Health check failed for ${service.name}`);
      return false;
    }
  }
}
