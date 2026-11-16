import { Body, Controller, HttpCode, Param, Post, UseGuards, ValidationPipe } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Auth, type AuthContext, HelperGuard } from '../auth';
import { ConfirmUploadResponse, IssueUploadBody, IssueUploadResponse } from './uploads.dto';
import { type ConfirmedUpload, type IssuedUpload, UploadsService } from './uploads.service';

const body = new ValidationPipe({ whitelist: true, transform: true });

@ApiTags('uploads')
@Controller()
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('sessions/:id/photos')
  @UseGuards(HelperGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ type: IssueUploadResponse })
  issue(@Auth() auth: AuthContext, @Body(body) input: IssueUploadBody): Promise<IssuedUpload> {
    return this.uploads.issueUploadUrl(auth.sessionId, input.contentType);
  }

  // The param is `photoId`, not `id`: the guard compares `:id` with the token's session.
  @Post('photos/:photoId/confirm')
  @UseGuards(HelperGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ type: ConfirmUploadResponse })
  confirm(@Auth() auth: AuthContext, @Param('photoId') photoId: string): Promise<ConfirmedUpload> {
    return this.uploads.confirmUpload(auth.sessionId, photoId);
  }
}
