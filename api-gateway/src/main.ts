import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as compression from 'compression';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  try {
    logger.log('Starting application bootstrap...');

    // Use NestJS built-in logger instead of WinstonLogger
    const app = await NestFactory.create(AppModule, {
      logger: ['error', 'warn', 'log', 'debug', 'verbose'],
    });

    const configService = app.get(ConfigService);
    const port = configService.get<number>('PORT', 3000);
    const apiPrefix = configService.get<string>('API_PREFIX', 'api');

    logger.log(`Configuration loaded - Port: ${port}, Prefix: ${apiPrefix}`);

    // Security
    app.use(helmet());
    // app.use(compression());

    // CORS
    app.enableCors({
      origin: configService.get<string>('CORS_ORIGIN', '*'),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      credentials: true,
    });

    // Global prefix
    app.setGlobalPrefix(apiPrefix);

    // API Versioning
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: '1',
    });

    // Global pipes
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      })
    );

    // Global filters
    app.useGlobalFilters(new HttpExceptionFilter());

    // Global interceptors
    app.useGlobalInterceptors(
      new LoggingInterceptor(),
      new ResponseInterceptor(),
      new TimeoutInterceptor(
        Number(configService.get<number>('HTTP_TIMEOUT', 5000))
      )
    );

    // Swagger documentation
    const config = new DocumentBuilder()
      .setTitle('Notification System API Gateway')
      .setDescription('API Gateway for Distributed Notification System')
      .setVersion('1.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
        'JWT'
      )
      .addTag('auth', 'Authentication endpoints')
      .addTag('notifications', 'Notification management')
      .addTag('health', 'Health check endpoints')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`${apiPrefix}/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    logger.log('Starting server...');
    await app.listen(port);

    logger.log(`
🚀 API Gateway is running!
📝 API Documentation: http://localhost:${port}/${apiPrefix}/docs
🏥 Health Check: http://localhost:${port}/${apiPrefix}/health
🌍 Environment: ${configService.get<string>('NODE_ENV')}
    `);
  } catch (error) {
    logger.error('Failed to bootstrap application:', error);
    process.exit(1);
  }
}

bootstrap();
