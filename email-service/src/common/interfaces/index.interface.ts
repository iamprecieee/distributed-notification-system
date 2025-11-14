import { CircuitState } from '../enums/index.enums';

export type TemplateVariableValue =
  | string
  | number
  | boolean
  | null
  | undefined;

export interface TemplateVariables {
  name?: string;
  link?: string;
  subject?: string;
  message?: string;
  title?: string;
  [key: string]: TemplateVariableValue;
}

export interface EmailMessage {
  notification_id: string;
  user_id: string;
  template_code: string;
  variables: TemplateVariables;
  request_id: string;
  priority: number;
  metadata?: Record<string, TemplateVariableValue>;
  to_email: string;
  retry_count?: number;
}

export interface CircuitBreakerStats {
  state: CircuitState;
  failure_count: number;
  success_count: number;
  last_failure_time: number | null;
}
