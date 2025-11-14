import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { AppModule } from './app.module';

interface RabbitMQMessage {
  content?: Buffer;
  properties?: {
    headers?: Record<string, unknown>;
  };
  fields?: {
    routingKey?: string;
  };
  pattern?: string;
  data?: unknown;
}

interface DeserializedMessage {
  pattern: string;
  data: unknown;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Email Service API')
    .setDescription('Distributed notification system - Email service')
    .setVersion('1.0')
    .addTag('health')
    .addTag('metrics')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  // Connect RabbitMQ microservice with custom deserializer
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.RMQ,
    options: {
      urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
      queue: 'email.queue',
      noAck: false,
      persistent: true,
      queueOptions: {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'dlx.exchange',
          'x-dead-letter-routing-key': 'failed',
          'x-message-ttl': 3600000, // 1 hour
        },
      },
      prefetchCount: 10,
      // Custom deserializer to handle messages from RabbitMQ UI
      deserializer: {
        deserialize: (
          value: Buffer | RabbitMQMessage | string,
        ): DeserializedMessage => {
          console.log('===== DEBUG MESSAGE STRUCTURE =====');
          console.log('Type:', typeof value);
          console.log('Is Buffer:', Buffer.isBuffer(value));

          if (typeof value === 'object' && value !== null) {
            console.log('Object keys:', Object.keys(value));
            console.log('Has content:', 'content' in value);
            console.log('Has pattern:', 'pattern' in value);
            console.log('Has data:', 'data' in value);
          }
          console.log('===================================');

          let content: string;
          let data: unknown;

          // Handle different message formats
          if (Buffer.isBuffer(value)) {
            // Direct buffer
            content = value.toString();
            console.log('Processing as Buffer');
          } else if (typeof value === 'string') {
            // Already a string
            content = value;
            console.log('Processing as string');
          } else if (typeof value === 'object' && value !== null) {
            const msg = value as RabbitMQMessage;

            // Check if already in deserialized format
            if ('pattern' in msg && 'data' in msg) {
              console.log('Already deserialized, returning as-is');
              return {
                pattern:
                  typeof msg.pattern === 'string' ? msg.pattern : 'email.queue',
                data: msg.data,
              };
            }

            // Check for content buffer
            if ('content' in msg && Buffer.isBuffer(msg.content)) {
              content = msg.content.toString();
              console.log('Processing content buffer');
            } else {
              // Log the full object to see its structure
              console.log('Full message object:', JSON.stringify(msg, null, 2));
              console.error('Message does not have expected content property');

              // Try to use the object directly as data
              data = msg;

              // Extract pattern
              const pattern =
                (msg.properties?.headers?.pattern as string) ||
                msg.fields?.routingKey ||
                'email.queue';

              console.log(
                'Using object directly as data with pattern:',
                pattern,
              );

              return {
                pattern,
                data,
              };
            }
          } else {
            console.error('Unexpected message format:', typeof value);
            content = String(value);
          }

          // Parse JSON content
          try {
            data = JSON.parse(content);
            console.log('Successfully parsed JSON content');
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : 'Unknown error';
            console.error('Failed to parse message content:', errorMessage);
            data = content;
          }

          // Extract pattern from headers or use default
          let pattern = 'email.queue';

          if (
            typeof value === 'object' &&
            value !== null &&
            !Buffer.isBuffer(value)
          ) {
            const msg = value as RabbitMQMessage;
            const headerPattern = msg.properties?.headers?.pattern;
            const routingKey = msg.fields?.routingKey;

            if (typeof headerPattern === 'string') {
              pattern = headerPattern;
            } else if (typeof routingKey === 'string') {
              pattern = routingKey;
            }
          }

          console.log(
            'Final deserialized - Pattern:',
            pattern,
            'Data type:',
            typeof data,
          );

          return {
            pattern,
            data,
          };
        },
      },
    },
  });

  app.enableShutdownHooks();

  // Start all microservices
  await app.startAllMicroservices();
  console.log('✅ RabbitMQ consumer connected');

  const port = process.env.PORT || 3003;
  await app.listen(port);
  console.log(`Email Service running on port ${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/api/docs`);
}
bootstrap();
