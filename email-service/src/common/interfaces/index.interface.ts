import { CircuitState } from "../enums/index.enums";

export interface EmailMessage {
  notification_id: string;
  user_id: string;
  template_code: string;
  variables: Record<string, any>;
  request_id: string;
  priority: number;
  metadata?: Record<string, any>;
  to_email: string;
  retry_count?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failure_count: number;
  success_count: number;
  last_failure_time: number | null;
}