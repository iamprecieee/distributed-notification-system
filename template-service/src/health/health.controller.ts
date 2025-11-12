import { Controller, Get } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { InjectConnection } from "@nestjs/typeorm";
import { Connection } from "typeorm";
import { RedisService } from "../common/redis/redis.service";
import { RabbitMQService } from "../common/messaging/rabbitmq.service";
import {
  CircuitBreakerService,
  CircuitState,
} from "../common/circuit-breaker/circuit-breaker.service";

type ServiceStatus = "healthy" | "degraded" | "down";

type ComponentHealth = {
  status: ServiceStatus;
  latency?: number;
  error?: string;
  circuitBreaker?: {
    state: CircuitState;
    failures: number;
    nextAttempt: number | null;
  };
};

type HealthResponse = {
  status: ServiceStatus;
  service: string;
  timestamp: string;
  uptime: number;
  checks: {
    database: ComponentHealth;
    redis: ComponentHealth;
    rabbitmq: ComponentHealth;
  };
};

@ApiTags("Health")
@Controller()
export class HealthController {
  private readonly startTime: number = Date.now();

  constructor(
    @InjectConnection() private readonly connection: Connection,
    private readonly redisService: RedisService,
    private readonly rabbitmqService: RabbitMQService,
    private readonly circuitBreakerService: CircuitBreakerService
  ) {}

  @Get("health")
  @ApiOperation({
    summary: "Health check",
    description:
      "Returns the health status of the service and all dependencies",
  })
  @ApiResponse({
    status: 200,
    description: "Service is healthy or degraded",
  })
  @ApiResponse({
    status: 503,
    description: "Service is down",
  })
  async getHealth(): Promise<HealthResponse> {
    const [dbHealth, redisHealth, rabbitmqHealth] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkRabbitMQ(),
    ]);

    const overallStatus = this.determineOverallStatus([
      dbHealth,
      redisHealth,
      rabbitmqHealth,
    ]);

    return {
      status: overallStatus,
      service: "template-service",
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      checks: {
        database: dbHealth,
        redis: redisHealth,
        rabbitmq: rabbitmqHealth,
      },
    };
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const resource = "db";
    const breakerStatus = await this.circuitBreakerService.getStatus(resource);
    const isOpen = await this.circuitBreakerService.isOpen(resource);

    if (isOpen) {
      return {
        status: "down",
        error: "Circuit breaker open",
        circuitBreaker: {
          state: breakerStatus.state,
          failures: breakerStatus.failures,
          nextAttempt: breakerStatus.nextAttempt,
        },
      };
    }

    const startTime = Date.now();
    try {
      await this.connection.query("SELECT 1");
      const latency = Date.now() - startTime;

      await this.circuitBreakerService.recordSuccess(resource);

      return {
        status: "healthy",
        latency,
        circuitBreaker: {
          state: CircuitState.CLOSED,
          failures: 0,
          nextAttempt: null,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      await this.circuitBreakerService.recordFailure(resource);

      return {
        status: "down",
        latency,
        error: error instanceof Error ? error.message : "Unknown error",
        circuitBreaker: {
          state: breakerStatus.state,
          failures: breakerStatus.failures + 1,
          nextAttempt: breakerStatus.nextAttempt,
        },
      };
    }
  }

  private async checkRedis(): Promise<ComponentHealth> {
    const resource = "redis";
    const breakerStatus = await this.circuitBreakerService.getStatus(resource);
    const isOpen = await this.circuitBreakerService.isOpen(resource);

    if (isOpen) {
      return {
        status: "down",
        error: "Circuit breaker open",
        circuitBreaker: {
          state: breakerStatus.state,
          failures: breakerStatus.failures,
          nextAttempt: breakerStatus.nextAttempt,
        },
      };
    }

    const startTime = Date.now();
    try {
      const testKey = "health:check:redis";
      await this.redisService.set(testKey, "ok", 10);
      const value = await this.redisService.get<string>(testKey);
      const latency = Date.now() - startTime;

      await this.circuitBreakerService.recordSuccess(resource);

      return {
        status: value === "ok" ? "healthy" : "degraded",
        latency,
        circuitBreaker: {
          state: CircuitState.CLOSED,
          failures: 0,
          nextAttempt: null,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      await this.circuitBreakerService.recordFailure(resource);

      return {
        status: "down",
        latency,
        error: error instanceof Error ? error.message : "Unknown error",
        circuitBreaker: {
          state: breakerStatus.state,
          failures: breakerStatus.failures + 1,
          nextAttempt: breakerStatus.nextAttempt,
        },
      };
    }
  }

  private checkRabbitMQ(): ComponentHealth {
    const isConnected = this.rabbitmqService.isConnected();

    return {
      status: isConnected ? "healthy" : "degraded",
      circuitBreaker: {
        state: CircuitState.CLOSED,
        failures: 0,
        nextAttempt: null,
      },
    };
  }

  private determineOverallStatus(checks: ComponentHealth[]): ServiceStatus {
    const hasDown = checks.some((check) => check.status === "down");
    const hasDegraded = checks.some((check) => check.status === "degraded");

    if (hasDown) return "down";
    if (hasDegraded) return "degraded";
    return "healthy";
  }
}
