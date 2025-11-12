import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as amqp from "amqplib";

type TemplateUpdatedPayload = {
  code: string;
  version: number;
  timestamp: string;
};

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private readonly exchangeName = "notifications.direct";
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }
    await this.close();
  }

  private async connect(): Promise<void> {
    try {
      const rabbitmqUrl = this.configService.get<string>(
        "RABBITMQ_URL",
        "amqp://guest:guest@rabbitmq:5672"
      );

      this.connection = await amqp.connect(rabbitmqUrl);
      this.logger.log("RabbitMQ connected");

      if (this.connection) {
        this.connection.on("error", (error: Error) => {
          this.logger.error(`RabbitMQ connection error: ${error.message}`);
          this.scheduleReconnect();
        });

        this.connection.on("close", () => {
          this.logger.warn("RabbitMQ connection closed");
          this.scheduleReconnect();
        });

        this.channel = await this.connection.createConfirmChannel();
        this.logger.log("RabbitMQ channel created");

        if (this.channel) {
          await this.channel.assertExchange(this.exchangeName, "direct", {
            durable: true,
          });
          this.logger.log(`Exchange '${this.exchangeName}' asserted`);

          this.channel.on("error", (error: Error) => {
            this.logger.error(`RabbitMQ channel error: ${error.message}`);
          });

          this.channel.on("close", () => {
            this.logger.warn("RabbitMQ channel closed");
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to connect to RabbitMQ: ${errorMessage}`);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) return;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.logger.log("Attempting to reconnect to RabbitMQ...");
      void this.connect();
    }, 5000);
  }

  async publishTemplateUpdated(code: string, version: number): Promise<void> {
    if (!this.channel) {
      this.logger.error("Cannot publish: RabbitMQ channel not available");
      throw new Error("RabbitMQ channel not available");
    }

    const payload: TemplateUpdatedPayload = {
      code,
      version,
      timestamp: new Date().toISOString(),
    };

    const routingKey = "template.updated";
    const message = Buffer.from(JSON.stringify(payload));

    try {
      this.channel.publish(this.exchangeName, routingKey, message, {
        persistent: true,
        contentType: "application/json",
      });

      this.logger.log(
        `Published template.updated event: code=${code}, version=${version}`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Failed to publish message: ${errorMessage}`);
      throw error;
    }
  }

  private async close(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
        this.channel = null;
        this.logger.log("RabbitMQ channel closed");
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
        this.logger.log("RabbitMQ connection closed");
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      this.logger.error(`Error closing RabbitMQ connection: ${errorMessage}`);
    }
  }

  isConnected(): boolean {
    return this.connection !== null && this.channel !== null;
  }
}
