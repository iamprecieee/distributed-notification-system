import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom, timeout } from 'rxjs';
import { getServiceByName } from '../../config/service-registry';

/**
 * Inter-Service Client
 * Provides methods for services to communicate with each other
 * This can be used by any service (not just the gateway)
 */
@Injectable()
export class InterServiceClient {
  private readonly logger = new Logger(InterServiceClient.name);

  constructor(private readonly httpService: HttpService) {}

  /**
   * Call User Service to get user details
   */
  async getUserById(userId: string, authToken?: string): Promise<any> {
    const service = getServiceByName('user-service');
    if (!service) {
      throw new Error('User service not found in registry');
    }

    try {
      const url = `${service.url}/api/users/${userId}`;
      const headers: any = {
        'X-Service-Call': 'true',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await firstValueFrom(
        this.httpService.get(url, { headers }).pipe(timeout(5000))
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to get user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Call User Service to get user preferences
   */
  async getUserPreferences(userId: string, authToken?: string): Promise<any> {
    const service = getServiceByName('user-service');
    if (!service) {
      throw new Error('User service not found in registry');
    }

    try {
      const url = `${service.url}/api/users/${userId}/preferences`;
      const headers: any = {
        'X-Service-Call': 'true',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await firstValueFrom(
        this.httpService.get(url, { headers }).pipe(timeout(5000))
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get preferences for user ${userId}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Call Template Service to get a template
   */
  async getTemplate(templateCode: string, authToken?: string): Promise<any> {
    const service = getServiceByName('template-service');
    if (!service) {
      throw new Error('Template service not found in registry');
    }

    try {
      const url = `${service.url}/api/templates/${templateCode}`;
      const headers: any = {
        'X-Service-Call': 'true',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await firstValueFrom(
        this.httpService.get(url, { headers }).pipe(timeout(5000))
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to get template ${templateCode}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Call Template Service to render a template
   */
  async renderTemplate(
    templateCode: string,
    variables: any,
    authToken?: string
  ): Promise<any> {
    const service = getServiceByName('template-service');
    if (!service) {
      throw new Error('Template service not found in registry');
    }

    try {
      const url = `${service.url}/api/templates/${templateCode}/render`;
      const headers: any = {
        'X-Service-Call': 'true',
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await firstValueFrom(
        this.httpService
          .post(url, { variables }, { headers })
          .pipe(timeout(5000))
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Failed to render template ${templateCode}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Update notification status
   */
  async updateNotificationStatus(
    notificationId: string,
    status: 'delivered' | 'pending' | 'failed',
    error?: string
  ): Promise<any> {
    // This would call back to the API Gateway or a shared notification service
    try {
      const url = process.env.API_GATEWAY_URL || 'http://api-gateway:3000';
      const response = await firstValueFrom(
        this.httpService
          .post(`${url}/api/notifications/${notificationId}/status`, {
            notification_id: notificationId,
            status,
            timestamp: new Date().toISOString(),
            error,
          })
          .pipe(timeout(5000))
      );

      return response.data;
    } catch (error) {
      this.logger.error(`Failed to update notification status:`, error.message);
      throw error;
    }
  }

  /**
   * Generic service call method
   */
  async callService(
    serviceName: string,
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    data?: any,
    authToken?: string
  ): Promise<any> {
    const service = getServiceByName(serviceName);
    if (!service) {
      throw new Error(`Service ${serviceName} not found in registry`);
    }

    try {
      const url = `${service.url}${path}`;
      const headers: any = {
        'X-Service-Call': 'true',
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const config = {
        method,
        url,
        headers,
        data: method !== 'GET' ? data : undefined,
        params: method === 'GET' ? data : undefined,
      };

      const response = await firstValueFrom(
        this.httpService.request(config).pipe(timeout(service.timeout))
      );

      return response.data;
    } catch (error) {
      this.logger.error(
        `Service call to ${serviceName} failed:`,
        error.message
      );
      throw error;
    }
  }
}
