import { Test, TestingModule } from "@nestjs/testing";
import {
  CircuitBreakerService,
  CircuitState,
} from "../common/circuit-breaker/circuit-breaker.service";
import { RedisService } from "../common/redis/redis.service";

describe("Circuit Breaker Verification", () => {
  let service: CircuitBreakerService;

  const mockRedisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CircuitBreakerService,
        {
          provide: RedisService,
          useValue: mockRedisService,
        },
      ],
    }).compile();

    service = module.get<CircuitBreakerService>(CircuitBreakerService);

    jest.clearAllMocks();
  });

  describe("Initial state", () => {
    it("should start in CLOSED state", async () => {
      mockRedisService.get.mockResolvedValue(null);

      const status = await service.getStatus("test-resource");

      expect(status.state).toBe(CircuitState.CLOSED);
      expect(status.failures).toBe(0);
      expect(status.successes).toBe(0);
      expect(status.nextAttempt).toBeNull();
    });
  });

  describe("Failure recording", () => {
    it("should increment failure count on failure", async () => {
      mockRedisService.get.mockResolvedValue(null);
      mockRedisService.set.mockResolvedValue(undefined);

      await service.recordFailure("test-resource");

      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:failures",
        "1",
        60
      );
    });

    it("should open circuit after 5 failures", async () => {
      mockRedisService.get
        .mockResolvedValueOnce("CLOSED")
        .mockResolvedValueOnce("4")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(null);

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      await service.recordFailure("test-resource");

      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:state",
        CircuitState.OPEN,
        90
      );
      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:open_time",
        expect.any(String),
        90
      );
    });

    it("should not record failures when circuit is already open", async () => {
      const openTime = Date.now();
      mockRedisService.get
        .mockResolvedValueOnce("OPEN")
        .mockResolvedValueOnce("5") 
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(openTime.toString());

      await service.recordFailure("test-resource");

      expect(mockRedisService.set).not.toHaveBeenCalledWith(
        "circuit:template_service:test-resource:failures",
        expect.any(String),
        expect.any(Number)
      );
    });
  });

  describe("Success recording", () => {
    it("should reset failure count on success in CLOSED state", async () => {
      mockRedisService.get
        .mockResolvedValueOnce("CLOSED")
        .mockResolvedValueOnce("2")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(null);

      mockRedisService.del.mockResolvedValue(undefined);

      await service.recordSuccess("test-resource");

      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:failures"
      );
    });

    it("should increment success count in HALF_OPEN state", async () => {
      mockRedisService.get
        .mockResolvedValueOnce("HALF_OPEN")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce(null);

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      await service.recordSuccess("test-resource");

      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:successes",
        "2",
        60
      );
    });

    it("should close circuit after 2 successes in HALF_OPEN state", async () => {
      mockRedisService.get
        .mockResolvedValueOnce("HALF_OPEN")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce("1")
        .mockResolvedValueOnce(null);

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      await service.recordSuccess("test-resource");

      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:state",
        CircuitState.CLOSED,
        60
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:failures"
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:successes"
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:open_time"
      );
    });
  });

  describe("Circuit state transitions", () => {
    it("should transition to HALF_OPEN after timeout", async () => {
      const openTime = Date.now() - 31000;
      mockRedisService.get
        .mockResolvedValueOnce("OPEN")
        .mockResolvedValueOnce("5")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(openTime.toString());

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      await service.recordFailure("test-resource");

      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:state",
        CircuitState.HALF_OPEN,
        60
      );
    });

    it("should allow request when timeout elapsed in OPEN state", async () => {
      const openTime = Date.now() - 31000;
      mockRedisService.get
        .mockResolvedValueOnce("OPEN")
        .mockResolvedValueOnce("5")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(openTime.toString());

      mockRedisService.set.mockResolvedValue(undefined);
      mockRedisService.del.mockResolvedValue(undefined);

      const isOpen = await service.isOpen("test-resource");

      expect(isOpen).toBe(false);
      expect(mockRedisService.set).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:state",
        CircuitState.HALF_OPEN,
        60
      );
    });

    it("should block request when circuit is OPEN and timeout not elapsed", async () => {
      const openTime = Date.now() - 10000;
      mockRedisService.get
        .mockResolvedValueOnce("OPEN")
        .mockResolvedValueOnce("5")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(openTime.toString());

      const isOpen = await service.isOpen("test-resource");

      expect(isOpen).toBe(true);
    });
  });

  describe("Circuit reset", () => {
    it("should reset all circuit breaker state", async () => {
      mockRedisService.del.mockResolvedValue(undefined);

      await service.reset("test-resource");

      expect(mockRedisService.del).toHaveBeenCalledTimes(4);
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:state"
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:failures"
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:successes"
      );
      expect(mockRedisService.del).toHaveBeenCalledWith(
        "circuit:template_service:test-resource:open_time"
      );
    });
  });

  describe("Status retrieval", () => {
    it("should return correct status with nextAttempt when OPEN", async () => {
      const openTime = Date.now();
      const expectedNextAttempt = openTime + 30 * 1000;

      mockRedisService.get
        .mockResolvedValueOnce("OPEN")
        .mockResolvedValueOnce("5")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(openTime.toString());

      const status = await service.getStatus("test-resource");

      expect(status.state).toBe(CircuitState.OPEN);
      expect(status.failures).toBe(5);
      expect(status.nextAttempt).toBe(expectedNextAttempt);
    });

    it("should return null nextAttempt when not OPEN", async () => {
      mockRedisService.get
        .mockResolvedValueOnce("CLOSED")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce("0")
        .mockResolvedValueOnce(null);

      const status = await service.getStatus("test-resource");

      expect(status.nextAttempt).toBeNull();
    });
  });
});
