import { ApiProperty } from '@nestjs/swagger';
import type { SessionState } from '../database/sessions.repository';

const STATES: SessionState[] = ['pending', 'claimed', 'finished', 'revoked', 'expired', 'closed'];

export class PendingPhotoDto {
  @ApiProperty({ format: 'uuid' }) photoId!: string;
  @ApiProperty({ example: 2097152 }) sizeBytes!: number;
  @ApiProperty({ format: 'date-time' }) uploadedAt!: string;
}

export class PendingListResponse {
  @ApiProperty({ enum: STATES }) state!: SessionState;
  @ApiProperty({ type: [PendingPhotoDto], description: 'Oldest first.' })
  photos!: PendingPhotoDto[];
}

export class DownloadUrlResponse {
  @ApiProperty({ format: 'uuid' }) photoId!: string;
  @ApiProperty({ description: 'Signed GET URL. Download the bytes from here, not the API.' })
  url!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
}

export class AcknowledgeResponse {
  @ApiProperty({ format: 'uuid' }) photoId!: string;
  @ApiProperty({ enum: ['downloaded'] }) status!: 'downloaded';
}
