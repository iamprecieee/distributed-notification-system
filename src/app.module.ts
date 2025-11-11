import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { IncomingMessage } from 'http';
import configuration from './config/configuration';
import { UsersModule } from './modules/users/users.module';
import { HealthModule } from './modules/health/health.module';
import { RedisModule } from './modules/redis/redis.module';
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDevelopment: boolean =
          configService.get<string>('environment') === 'development';

        return {
          pinoHttp: {
            level: configService.get<string>('logging.level') || 'info',
            redact: {
              paths: [
                'req.headers.cookie',
                'req.headers.authorization',
                'req.headers["x-api-key"]',
              ],
              remove: true,
            },
            transport: isDevelopment
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'SYS:standard',
                    ignore: 'pid,hostname',
                    singleLine: false,
                    messageFormat: '{req.method} {req.url} - {msg}',
                  },
                }
              : undefined,
            formatters: {
              level: (label: string) => {
                return { level: label };
              },
            },
            serializers: {
              req: (req: IncomingMessage) => ({
                id: (req as IncomingMessage & { id?: string }).id,
                method: req.method,
                url: req.url,
              }),
              res: (res: { statusCode?: number }) => ({
                statusCode: res.statusCode,
              }),
              err: (err: Error & { type?: string; code?: string }) => {
                const serialized: Record<string, unknown> = {
                  type: err.type || err.constructor?.name || 'Error',
                  message: err.message,
                };

                if (err.code) {
                  serialized.code = err.code;
                }

                if (isDevelopment && err.stack) {
                  serialized.stack = err.stack;
                }

                return serialized;
              },
            },
            customProps: () => ({
              service: configService.get<string>('serviceName'),
            }),
            autoLogging: {
              ignore: (req: IncomingMessage) => {
                const url = req.url || '';
                return url.includes('/health') || url.includes('/metrics');
              },
            },
          },
        };
      },
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres' as const,
        host: configService.get<string>('database.host'),
        port: configService.get<number>('database.port'),
        username: configService.get<string>('database.username'),
        password: configService.get<string>('database.password'),
        database: configService.get<string>('database.database'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: configService.get<string>('environment') === 'development',
        logging: configService.get<string>('environment') === 'development',
      }),
    }),
    UsersModule,
    HealthModule,
    RedisModule,
  ],
})
export class AppModule {}
