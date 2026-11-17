import { Body, Controller, HttpCode, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiNoContentResponse, ApiTags } from '@nestjs/swagger';
import { Auth, type AuthContext, RequesterGuard } from '../auth';
import { RegisterDeviceBody } from './devices.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller()
export class DevicesController {
  constructor(private readonly notifications: NotificationsService) {}

  @Post('sessions/:id/device')
  @UseGuards(RequesterGuard)
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiNoContentResponse({ description: 'Registered (or updated if this token was already set).' })
  async register(
    @Auth() auth: AuthContext,
    @Body(new ValidationPipe({ whitelist: true, transform: true })) input: RegisterDeviceBody,
  ): Promise<void> {
    await this.notifications.registerDevice(auth.sessionId, input.platform, input.pushToken);
  }
}
