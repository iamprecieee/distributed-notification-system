import { Injectable, Logger } from "@nestjs/common";
import { RedisService } from "../redis/redis.service";

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

type CircuitBreakerConfig = {
  failureThreshold: number;
  successThreshold: number;
  timeout: number;
};

type CircuitBreakerStatus = {
  state: CircuitState;
  failures: number;
  successes: number;
  nextAttempt: number | null;
};

@Injectable()
export class CircuitBreakerService {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly config: CircuitBreakerConfig = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 30,
  };

  constructor(private readonly redisService: RedisService) {}

  private getFailureKey(resource: string): string {
    return `circuit:template_service:${resource}:failures`;
  }

  private getSuccessKey(resource: string): string {
    return `circuit:template_service:${resource}:successes`;
  }

  private getStateKey(resource: string): string {
    return `circuit:template_service:${resource}:state`;
  }

  private getOpenTimeKey(resource: string): string {
    return `circuit:template_service:${resource}:open_time`;
  }

  async getStatus(resource: string): Promise<CircuitBreakerStatus> {
    const [state, failures, successes, openTime] = await Promise.all([
      this.redisService.get<string>(this.getStateKey(resource)),
      this.redisService.get<string>(this.getFailureKey(resource)),
      this.redisService.get<string>(this.getSuccessKey(resource)),
      this.redisService.get<string>(this.getOpenTimeKey(resource)),
    ]);

    const currentState = (state as CircuitState) || CircuitState.CLOSED;
    const failureCount = failures ? parseInt(failures, 10) : 0;
    const successCount = successes ? parseInt(successes, 10) : 0;
    const openTimestamp = openTime ? parseInt(openTime, 10) : null;

    let nextAttempt: number | null = null;
    if (currentState === CircuitState.OPEN && openTimestamp) {
      nextAttempt = openTimestamp + this.config.timeout * 1000;
    }

    return {
      state: currentState,
      failures: failureCount,
      successes: successCount,
      nextAttempt,
    };
  }

  async recordSuccess(resource: string): Promise<void> {
    const status = await this.getStatus(resource);

    if (status.state === CircuitState.HALF_OPEN) {
      const newSuccesses = status.successes + 1;
      await this.redisService.set(
        this.getSuccessKey(resource),
        newSuccesses.toString(),
        60
      );

      if (newSuccesses >= this.config.successThreshold) {
        await this.closeCircuit(resource);
        this.logger.log(
          `[CIRCUIT_CLOSED] ${resource} - ${newSuccesses} consecutive successes`
        );
      }
    } else if (status.state === CircuitState.CLOSED) {
      await this.redisService.del(this.getFailureKey(resource));
    }
  }

  async recordFailure(resource: string): Promise<void> {
    const status = await this.getStatus(resource);

    if (status.state === CircuitState.OPEN) {
      if (status.nextAttempt && Date.now() >= status.nextAttempt) {
        await this.halfOpenCircuit(resource);
        this.logger.log(`[CIRCUIT_HALF_OPEN] ${resource} - timeout elapsed`);
      }
      return;
    }

    const newFailures = status.failures + 1;
    await this.redisService.set(
      this.getFailureKey(resource),
      newFailures.toString(),
      60
    );

    if (newFailures >= this.config.failureThreshold) {
      await this.openCircuit(resource);
      this.logger.error(
        `[CIRCUIT_OPEN] ${resource} - ${newFailures} consecutive failures`
      );
    } else {
      this.logger.warn(
        `[CIRCUIT_FAILURE] ${resource} - ${newFailures}/${this.config.failureThreshold} failures`
      );
    }
  }

  async isOpen(resource: string): Promise<boolean> {
    const status = await this.getStatus(resource);

    if (status.state === CircuitState.OPEN) {
      if (status.nextAttempt && Date.now() >= status.nextAttempt) {
        await this.halfOpenCircuit(resource);
        return false;
      }
      return true;
    }

    return false;
  }

  private async openCircuit(resource: string): Promise<void> {
    const openTime = Date.now();
    await Promise.all([
      this.redisService.set(
        this.getStateKey(resource),
        CircuitState.OPEN,
        this.config.timeout + 60
      ),
      this.redisService.set(
        this.getOpenTimeKey(resource),
        openTime.toString(),
        this.config.timeout + 60
      ),
      this.redisService.del(this.getSuccessKey(resource)),
    ]);
  }

  private async halfOpenCircuit(resource: string): Promise<void> {
    await Promise.all([
      this.redisService.set(
        this.getStateKey(resource),
        CircuitState.HALF_OPEN,
        60
      ),
      this.redisService.del(this.getFailureKey(resource)),
      this.redisService.del(this.getSuccessKey(resource)),
    ]);
  }

  private async closeCircuit(resource: string): Promise<void> {
    await Promise.all([
      this.redisService.set(
        this.getStateKey(resource),
        CircuitState.CLOSED,
        60
      ),
      this.redisService.del(this.getFailureKey(resource)),
      this.redisService.del(this.getSuccessKey(resource)),
      this.redisService.del(this.getOpenTimeKey(resource)),
    ]);
  }

  async reset(resource: string): Promise<void> {
    await Promise.all([
      this.redisService.del(this.getStateKey(resource)),
      this.redisService.del(this.getFailureKey(resource)),
      this.redisService.del(this.getSuccessKey(resource)),
      this.redisService.del(this.getOpenTimeKey(resource)),
    ]);
    this.logger.log(`[CIRCUIT_RESET] ${resource}`);
  }
}
