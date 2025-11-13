import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  UseGuards,
  Request,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiHeader,
} from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { JwtAuthGuard } from '../../core/auth/jwt-auth.guard';
import { CurrentUser } from '../../core/auth/current-user.decorator';
import { SkipAuth } from 'src/core/auth/skip-auth.decorator';

@ApiTags('notifications')
@Controller('notifications')
// @SkipAuth()
// @UseGuards(JwtAuthGuard)
// @ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  /**
   * Gateway-specific endpoint: Send notification
   * This is the ONLY endpoint the gateway handles directly
   */
  @Post('send')
  @ApiOperation({
    summary: 'Send notification (Gateway handles this)',
    description: 'Routes notification to appropriate queue (email/push)',
  })
  @ApiHeader({
    name: 'x-idempotency-key',
    description: 'Unique key to prevent duplicate requests',
    required: true,
  })
  @UseGuards(JwtAuthGuard)
  async sendNotification(
    @Body() dto: SendNotificationDto,
    @Headers('x-idempotency-key') idempotencyKey: string,
    @CurrentUser() user: any
  ) {
    return this.notificationService.sendNotification(dto, idempotencyKey, user);
  }

  /**
   * Gateway-specific endpoint: Get notification status
   */
  @UseGuards(JwtAuthGuard)
  @Get('status/:notification_id')
  @ApiOperation({
    summary: 'Get notification status (Gateway tracks this)',
    description: 'Retrieve notification delivery status from Redis',
  })
  async getNotificationStatus(
    @Param('notification_id') notificationId: string
  ) {
    return this.notificationService.getStatus(notificationId);
  }
}
