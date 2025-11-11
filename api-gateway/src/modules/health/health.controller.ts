import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SkipAuth } from '../../core/auth/skip-auth.decorator';
import { ProxyService } from '../../core/proxy/proxy.service';
import { getAllServices } from '../../config/service-registry';

@ApiTags('health')
@Controller('health')
@SkipAuth()
export class HealthController {
  constructor(private readonly proxyService: ProxyService) {}

  @Get()
  @ApiOperation({ summary: 'Gateway health check' })
  healthCheck() {
    return {
      success: true,
      data: {
        status: 'healthy',
        service: 'api-gateway',
        timestamp: new Date().toISOString(),
      },
      message: 'API Gateway is healthy',
      meta: null,
    };
  }

  @Get('services')
  @ApiOperation({ summary: 'Check all registered services health' })
  async checkServices() {
    const services = getAllServices();
    const healthChecks = await Promise.all(
      services.map(async (service) => ({
        name: service.name,
        url: service.url,
        healthy: await this.proxyService.checkServiceHealth(service),
      }))
    );

    const allHealthy = healthChecks.every((check) => check.healthy);

    return {
      success: true,
      data: {
        gateway_status: 'healthy',
        services: healthChecks,
        all_services_healthy: allHealthy,
      },
      message: allHealthy ? 'All services healthy' : 'Some services unhealthy',
      meta: null,
    };
  }
}
