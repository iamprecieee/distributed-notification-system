export interface ServiceConfig {
  name: string;
  url: string;
  prefix: string;
  timeout?: number;
  requiresAuth?: boolean;
  healthCheck?: string;
}

export const SERVICE_REGISTRY: ServiceConfig[] = [
  {
    name: 'user-service',
    url: process.env.USER_SERVICE_URL || 'http://localhost:8083',
    prefix: '',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
  {
    name: 'template-service',
    url: process.env.TEMPLATE_SERVICE_URL || 'http://localhost:8084',
    prefix: '',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
  {
    name: 'email-service',
    url: process.env.EMAIL_SERVICE_URL || 'http://localhost:8085',
    prefix: '/email',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
  {
    name: 'push-service',
    url: process.env.PUSH_SERVICE_URL || 'http://localhost:8082',
    prefix: '',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
];

export function getServiceByPrefix(prefix: string): ServiceConfig | undefined {
  return SERVICE_REGISTRY.find((service) => prefix.startsWith(service.prefix));
}

export function getAllServices(): ServiceConfig[] {
  return SERVICE_REGISTRY;
}

export function getServiceByName(name: string): ServiceConfig | undefined {
  return SERVICE_REGISTRY.find((service) => service.name === name);
}
