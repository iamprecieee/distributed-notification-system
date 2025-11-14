import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface StatusUpdate {
  notification_id: string;
  status: 'pending' | 'delivered' | 'failed';
  timestamp: Date;
  error?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class StatusService {
  private readonly logger = new Logger(StatusService.name);

  constructor(private httpService: HttpService) {}

  async updateStatus(update: StatusUpdate): Promise<void> {
    try {
      const apiGatewayUrl =
        process.env.API_GATEWAY_URL || 'http://localhost:3000';

      await firstValueFrom(
        this.httpService.post(`${apiGatewayUrl}/api/v1/email/status`, {
          notification_id: update.notification_id,
          status: update.status,
          timestamp: update.timestamp.toISOString(),
          error: update.error || null,
          metadata: update.metadata || {},
        }),
      );

      this.logger.log(
        `Status updated for ${update.notification_id}: ${update.status}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update status for ${update.notification_id}`,
        error,
      );
    }
  }
}
