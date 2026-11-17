import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Auth, type AuthContext, RequesterGuard } from '../auth';
import { AcknowledgeResponse, DownloadUrlResponse, PendingListResponse } from './delivery.dto';
import {
  type Acknowledged,
  DeliveryService,
  type DownloadUrl,
  type PendingList,
} from './delivery.service';

@ApiTags('delivery')
@Controller()
@UseGuards(RequesterGuard)
@ApiBearerAuth()
export class DeliveryController {
  constructor(private readonly delivery: DeliveryService) {}

  @Get('sessions/:id/photos')
  @ApiOkResponse({ type: PendingListResponse })
  list(@Auth() auth: AuthContext): Promise<PendingList> {
    return this.delivery.listPending(auth.sessionId);
  }

  // The param is `photoId`, not `id`: the guard compares `:id` with the token's session.
  @Get('photos/:photoId/download')
  @ApiOkResponse({ type: DownloadUrlResponse })
  download(@Auth() auth: AuthContext, @Param('photoId') photoId: string): Promise<DownloadUrl> {
    return this.delivery.getDownloadUrl(auth.sessionId, photoId);
  }

  @Post('photos/:photoId/ack')
  @HttpCode(200)
  @ApiOkResponse({ type: AcknowledgeResponse })
  ack(@Auth() auth: AuthContext, @Param('photoId') photoId: string): Promise<Acknowledged> {
    return this.delivery.acknowledge(auth.sessionId, photoId);
  }
}
