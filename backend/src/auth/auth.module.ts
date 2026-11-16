import { Module } from '@nestjs/common';
import { AnyTokenGuard } from './any-token.guard';
import { HelperGuard } from './helper.guard';
import { RequesterGuard } from './requester.guard';
import { TokenIdentifier } from './token-identifier';
import { TokenService } from './token.service';

/** Token service and guards. Modules that protect routes import this module. */
@Module({
  providers: [TokenService, TokenIdentifier, HelperGuard, RequesterGuard, AnyTokenGuard],
  exports: [TokenService, TokenIdentifier, HelperGuard, RequesterGuard, AnyTokenGuard],
})
export class AuthModule {}
