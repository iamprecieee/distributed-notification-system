import { ApiProperty } from '@nestjs/swagger';

export class NotificationResponseDto {
  @ApiProperty()
  notification_id: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  queues_sent: string[];

  @ApiProperty()
  estimated_delivery: string;
}
