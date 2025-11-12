import { NestFactory } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const configService = app.get<ConfigService>(ConfigService);

  const logger = app.get(Logger);
  app.useLogger(logger);

  // Global prefix
  app.setGlobalPrefix(configService.get('apiPrefix') || 'api/v1', {
    exclude: ['health', 'health/test-redis'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global class serializer interceptor (for @Exclude decorators)
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get('Reflector')),
  );

  app.enableCors({
    origin:
      // configService.get('environment') === 'development'
      //   ? '*'
      //   : ['https://yourdomain.com'],
      '*',
    credentials: true,
  });

  // Swagger documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('User Service API')
    .setDescription(
      'Microservice for managing user data, authentication, and notification preferences in the distributed notification system',
    )
    .setVersion('1.0.0')
    .addTag('users', 'User management endpoints')
    .addTag('auth', 'Authentication endpoints')
    .addTag('health', 'Health check endpoints')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
        name: 'Authorization',
        in: 'header',
      },
      'JWT-auth',
    )
    // .addServer(
    //   `http://localhost:${configService.get('port')}`,
    //   'Local Development',
    // )
    // .addServer('https://api.yourdomain.com', 'Production')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'User Service API Docs',
    customfavIcon: 'https://nestjs.com/img/logo-small.svg',
    customCss: '.swagger-ui .topbar { display: none }',
    swaggerOptions: {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      showRequestDuration: true,
    },
  });

  // Graceful shutdown
  app.enableShutdownHooks();

  const port = configService.get<number>('port') || 3000;
  await app.listen(port, '0.0.0.0');
  logger.log(`User Service running on port ${port}`);
  logger.log(`API Documentation: http://localhost:${port}/api/docs`);
}
void bootstrap();
