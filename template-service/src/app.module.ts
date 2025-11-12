import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import configuration from "./common/config/configuration";
import { HealthModule } from "./health/health.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { RedisModule } from "./common/redis/redis.module";
import { RabbitMQModule } from "./common/messaging/rabbitmq.module";
import { CircuitBreakerModule } from "./common/circuit-breaker/circuit-breaker.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        host: config.get<string>("DATABASE_HOST", "postgres"),
        port: config.get<number>("DATABASE_PORT", 5432),
        username: config.get<string>("DATABASE_USER", "postgres"),
        password: config.get<string>("DATABASE_PASSWORD", ""),
        database: config.get<string>("DATABASE_NAME", "template_db"),
        entities: [__dirname + "/**/*.entity{.ts,.js}"],
        migrations: [__dirname + "/migrations/*{.ts,.js}"],
        migrationsRun: false,
        synchronize: false,
        logging: true,
      }),
    }),
    RedisModule,
    RabbitMQModule,
    CircuitBreakerModule,
    HealthModule,
    TemplatesModule,
  ],
})
export class AppModule {}
