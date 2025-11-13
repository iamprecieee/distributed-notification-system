export interface ServiceConfig {
  name: string;
  url: string;
  prefix: string; // NOTE: prefix should **not include /api**
  timeout?: number;
  requiresAuth?: boolean;
  healthCheck?: string;
}

export const SERVICE_REGISTRY: ServiceConfig[] = [
  {
    name: 'user-service',
    url: process.env.USER_SERVICE_URL || 'http://localhost:3001',
    prefix: '/v1/users', // remove /api
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
  {
    name: 'template-service',
    url: process.env.TEMPLATE_SERVICE_URL || 'http://localhost:3002',
    prefix: '/v1/templates',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
  {
    name: 'email-service',
    url: process.env.EMAIL_SERVICE_URL || 'http://localhost:3003',
    prefix: '/v1/email',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
  {
    name: 'push-service',
    url: process.env.PUSH_SERVICE_URL || 'http://localhost:8080',
    prefix: '/v1/push',
    timeout: 5000,
    requiresAuth: false,
    healthCheck: '/health',
  },
];

// Match the longest prefix first
export function getServiceByPrefix(path: string): ServiceConfig | undefined {
  const trimmedPath = path.replace(/\/$/, ''); // remove trailing slash
  return SERVICE_REGISTRY.sort(
    (a, b) => b.prefix.length - a.prefix.length
  ).find((service) => trimmedPath.startsWith(service.prefix));
}

export function getAllServices(): ServiceConfig[] {
  return SERVICE_REGISTRY;
}

export function getServiceByName(name: string): ServiceConfig | undefined {
  return SERVICE_REGISTRY.find((service) => service.name === name);
}
