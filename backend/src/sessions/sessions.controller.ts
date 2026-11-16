import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  AnyTokenGuard,
  Auth,
  type AuthContext,
  HelperGuard,
  RateLimited,
  RequesterGuard,
} from '../auth';
import {
  ClaimSessionBody,
  ClaimSessionResponse,
  CreateSessionResponse,
  FinishSessionBody,
  SessionStatusResponse,
} from './sessions.dto';
import {
  type ClaimedSession,
  type CreatedSession,
  type SessionStatus,
  SessionsService,
} from './sessions.service';

// Unknown fields are dropped, not rejected: beacons add `token` to the body.
const body = new ValidationPipe({ whitelist: true, transform: true });

@ApiTags('sessions')
@Controller('sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Post()
  @RateLimited()
  @ApiOkResponse({ type: CreateSessionResponse })
  @HttpCode(200)
  create(): Promise<CreatedSession> {
    return this.sessions.createSession();
  }

  @Post(':id/claim')
  @RateLimited()
  @HttpCode(200)
  @ApiOkResponse({ type: ClaimSessionResponse })
  claim(@Param('id') id: string, @Body(body) input: ClaimSessionBody): Promise<ClaimedSession> {
    return this.sessions.claimSession(id, input.secret);
  }

  @Get(':id')
  @UseGuards(AnyTokenGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionStatusResponse })
  status(@Auth() auth: AuthContext): Promise<SessionStatus> {
    return this.sessions.getStatus(auth.sessionId);
  }

  @Post(':id/revoke')
  @UseGuards(RequesterGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionStatusResponse })
  revoke(@Auth() auth: AuthContext): Promise<SessionStatus> {
    return this.sessions.revokeSession(auth.sessionId);
  }

  @Post(':id/finish')
  @UseGuards(HelperGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionStatusResponse })
  finish(
    @Auth() auth: AuthContext,
    @Body(body) input: FinishSessionBody | undefined,
  ): Promise<SessionStatus> {
    return this.sessions.finish(auth.sessionId, input?.graceSeconds);
  }

  @Post(':id/resume')
  @UseGuards(HelperGuard)
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOkResponse({ type: SessionStatusResponse })
  resume(@Auth() auth: AuthContext): Promise<SessionStatus> {
    return this.sessions.resume(auth.sessionId);
  }
}
