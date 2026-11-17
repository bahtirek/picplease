import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { SessionState } from '../database/sessions.repository';
import { MAX_GRACE_SECONDS } from './sessions.constants';

const STATES: SessionState[] = ['pending', 'claimed', 'finished', 'revoked', 'expired', 'closed'];

export class LimitsDto {
  @ApiProperty({ example: 5 }) maxInFlight!: number;
  @ApiProperty({ example: 5242880 }) maxPhotoBytes!: number;
  @ApiProperty({ example: 600 }) uploadUrlTtlSeconds!: number;
  @ApiProperty({ example: 600 }) downloadUrlTtlSeconds!: number;
}

export class CreateSessionResponse {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ description: 'https://picplease.app/s/{sessionId}?t={pairingSecret}' })
  link!: string;
  @ApiProperty({ description: 'QR code of the link, PNG, base64' }) qrPngBase64!: string;
  @ApiProperty({ description: 'Bearer token for requester calls. Shown once.' })
  requesterToken!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: LimitsDto }) limits!: LimitsDto;
}

export class ClaimSessionBody {
  @ApiProperty({ description: 'The pairing secret from the QR link (t parameter)' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  secret!: string;
}

export class ClaimSessionResponse {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ description: 'Bearer token for helper calls.' }) helperToken!: string;
  @ApiProperty({ type: LimitsDto }) limits!: LimitsDto;
}

export class FinishSessionBody {
  @ApiPropertyOptional({
    description: `Seconds before finishing; capped at ${String(MAX_GRACE_SECONDS)}. Absent or 0 finishes now.`,
    minimum: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  graceSeconds?: number;

  /** Web beacons cannot set headers, so they send the token here (read by the guard). */
  @ApiPropertyOptional({ description: 'Helper token, for beacons that cannot set headers' })
  @IsOptional()
  @IsString()
  token?: string;
}

export class SessionStatusResponse {
  @ApiProperty({ format: 'uuid' }) sessionId!: string;
  @ApiProperty({ enum: STATES }) state!: SessionState;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) claimedAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) finishedAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) closedAt!: string | null;
  @ApiProperty({ format: 'date-time', nullable: true, type: String }) revokedAt!: string | null;
}
