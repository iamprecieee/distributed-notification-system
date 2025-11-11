import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from '../health/health.controller';
import { RedisService } from '../common/redis/redis.service';
import { RabbitMQService } from '../common/messaging/rabbitmq.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '../common/circuit-breaker/circuit-breaker.service';
import { getConnectionToken } from '@nestjs/typeorm';

describe('HealthController', () => {
  let controller: HealthController;

  const mockConnection = {
    query: jest.fn(),
  };

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
  };

  const mockRabbitMQService = {
    isConnected: jest.fn(),
  };

  const mockCircuitBreakerService = {
    getStatus: jest.fn(),
    isOpen: jest.fn(),
    recordSuccess: jest.fn(),
    recordFailure: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: getConnectionToken(),
          useValue: mockConnection,
        },
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
        {
          provide: RabbitMQService,
          useValue: mockRabbitMQService,
        },
        {
          provide: CircuitBreakerService,
          useValue: mockCircuitBreakerService,
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);

    jest.clearAllMocks();
  });

  describe('getHealth', () => {
    it('should return healthy status when all services are healthy', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('ok');
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.status).toBe('healthy');
      expect(result.service).toBe('template-service');
      expect(result.checks.database.status).toBe('healthy');
      expect(result.checks.redis.status).toBe('healthy');
      expect(result.checks.rabbitmq.status).toBe('healthy');
      expect(result.uptime).toBeGreaterThanOrEqual(0);
    });

    it('should return degraded status when RabbitMQ is disconnected', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('ok');
      mockRabbitMQService.isConnected.mockReturnValue(false);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.rabbitmq.status).toBe('degraded');
    });

    it('should return down status when database is down', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockRejectedValue(new Error('Database error'));
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('ok');
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordFailure.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.status).toBe('down');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.error).toBe('Database error');
      expect(mockCircuitBreakerService.recordFailure).toHaveBeenCalledWith(
        'db',
      );
    });

    it('should return down status when circuit breaker is open', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.OPEN,
        failures: 5,
        successes: 0,
        nextAttempt: Date.now() + 30000,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(true);

      const result = await controller.getHealth();

      expect(result.status).toBe('down');
      expect(result.checks.database.status).toBe('down');
      expect(result.checks.database.error).toBe('Circuit breaker open');
      expect(mockConnection.query).not.toHaveBeenCalled();
    });

    it('should return down status when Redis is down', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockRejectedValue(new Error('Redis error'));
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);
      mockCircuitBreakerService.recordFailure.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.status).toBe('down');
      expect(result.checks.redis.status).toBe('down');
      expect(result.checks.redis.error).toBe('Redis error');
      expect(mockCircuitBreakerService.recordFailure).toHaveBeenCalledWith(
        'redis',
      );
    });

    it('should return degraded status when Redis returns wrong value', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('wrong-value');
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.status).toBe('degraded');
      expect(result.checks.redis.status).toBe('degraded');
    });

    it('should include latency in response', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('ok');
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.checks.database.latency).toBeDefined();
      expect(result.checks.database.latency).toBeGreaterThanOrEqual(0);
      expect(result.checks.redis.latency).toBeDefined();
      expect(result.checks.redis.latency).toBeGreaterThanOrEqual(0);
    });

    it('should include circuit breaker status in response', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('ok');
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);

      const result = await controller.getHealth();

      expect(result.checks.database.circuitBreaker).toBeDefined();
      expect(result.checks.database.circuitBreaker!.state).toBe(
        CircuitState.CLOSED,
      );
      expect(result.checks.redis.circuitBreaker).toBeDefined();
      expect(result.checks.rabbitmq.circuitBreaker).toBeDefined();
    });

    it('should record success when database check passes', async () => {
      mockCircuitBreakerService.getStatus.mockResolvedValue({
        state: CircuitState.CLOSED,
        failures: 0,
        successes: 0,
        nextAttempt: null,
      });
      mockCircuitBreakerService.isOpen.mockResolvedValue(false);
      mockConnection.query.mockResolvedValue([{ '?column?': 1 }]);
      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.get.mockResolvedValue('ok');
      mockRabbitMQService.isConnected.mockReturnValue(true);
      mockCircuitBreakerService.recordSuccess.mockResolvedValue(undefined);

      await controller.getHealth();

      expect(mockCircuitBreakerService.recordSuccess).toHaveBeenCalledWith(
        'db',
      );
      expect(mockCircuitBreakerService.recordSuccess).toHaveBeenCalledWith(
        'redis',
      );
    });
  });
});

