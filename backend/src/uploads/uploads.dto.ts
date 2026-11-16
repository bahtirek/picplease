import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { UPLOAD_CONTENT_TYPES, type UploadContentType } from './uploads.constants';

export class IssueUploadBody {
  @ApiProperty({ enum: UPLOAD_CONTENT_TYPES, example: 'image/jpeg' })
  @IsIn(UPLOAD_CONTENT_TYPES)
  contentType!: UploadContentType;
}

export class IssueUploadResponse {
  @ApiProperty({ format: 'uuid' }) photoId!: string;
  @ApiProperty({ description: 'Signed PUT URL. Upload the photo bytes here, not to the API.' })
  url!: string;
  @ApiProperty({
    description: 'Headers to send with the PUT exactly as given; they are signed.',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  headers!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class ConfirmUploadResponse {
  @ApiProperty({ format: 'uuid' }) photoId!: string;
  @ApiProperty({ enum: ['uploaded'] }) status!: 'uploaded';
}
