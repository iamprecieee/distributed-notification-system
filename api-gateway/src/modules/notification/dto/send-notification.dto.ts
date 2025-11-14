import {
  IsEnum,
  IsString,
  IsObject,
  IsOptional,
  IsUUID,
  IsNumber,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum NotificationType {
  EMAIL = 'email',
  PUSH = 'push',
}

export type UserData = {
  name: string;
  link: string;
  subject: string;
  // meta?: Record<string, any>;
};

export class SendNotificationDto {
  @ApiProperty({ enum: NotificationType, example: NotificationType.EMAIL })
  @IsEnum(NotificationType)
  notification_type: NotificationType;

  // @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  // @IsString()
  // @IsUUID()
  // user_id: string;

  @ApiProperty({ example: '660e8400-e29b-41d4-a716-446655440001' })
  @IsString()
  template_code: string;

  @ApiProperty({
    example: { name: 'John Doe', link: '<user_link>', meta: { age: 30 } },
  })
  @IsObject()
  variables: UserData;

  @ApiProperty({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  request_id: string;

  @ApiProperty({ example: 1 })
  @IsNumber()
  priority: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
