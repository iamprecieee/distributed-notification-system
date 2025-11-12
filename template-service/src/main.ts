import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    })
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle("Template Service API")
    .setDescription(
      "Template Service manages reusable notification templates with versioning, caching, and event publishing"
    )
    .setVersion("1.0")
    .addTag("Templates", "CRUD operations for notification templates")
    .addTag("Health", "Service health check endpoints")
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document, {
    customSiteTitle: "Template Service API",
    customCss: ".swagger-ui .topbar { display: none }",
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>("PORT", 8084);

  await app.listen(port);
  console.log(`Template Service running on port ${port}`);
  console.log(
    `Swagger documentation available at http://localhost:${port}/api/docs`
  );
}

bootstrap();
