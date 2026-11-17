import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiProperty, ApiTags } from '@nestjs/swagger';
import { type BuildInfo, readBuildInfo } from './build-info';

export class HealthBuild {
  @ApiProperty({
    description: 'Short git commit, or "unknown" outside a build',
    example: '51bea1d',
  })
  commit!: string;

  @ApiProperty({
    description: 'ISO time of the build, or "unknown"',
    example: '2026-11-16T10:00:00.000Z',
  })
  builtAt!: string;
}

export class HealthResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: HealthBuild })
  build!: HealthBuild;
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  // Read once at startup: the file only changes with a new release.
  private readonly build: BuildInfo = readBuildInfo();

  @Get()
  @ApiOkResponse({ type: HealthResponse })
  check(): HealthResponse {
    return { status: 'ok', build: { ...this.build } };
  }
}
