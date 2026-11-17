import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, Matches } from 'class-validator';
import type { DevicePlatform } from '../database/devices.repository';
import { DEVICE_PLATFORMS, PUSH_TOKEN_PATTERN } from './notifications.constants';

export class RegisterDeviceBody {
  @ApiProperty({ enum: DEVICE_PLATFORMS })
  @IsIn(DEVICE_PLATFORMS)
  platform!: DevicePlatform;

  @ApiProperty({ description: 'APNs device token (hex) or FCM registration token.' })
  @IsString()
  @Matches(PUSH_TOKEN_PATTERN)
  pushToken!: string;
}
