import { Module } from '@nestjs/common';
import { AnyTokenGuard } from './any-token.guard';
import { HelperGuard } from './helper.guard';
import { RequesterGuard } from './requester.guard';
import { TokenService } from './token.service';

/** Token service and guards. Modules that protect routes import this module. */
@Module({
  providers: [TokenService, HelperGuard, RequesterGuard, AnyTokenGuard],
  exports: [TokenService, HelperGuard, RequesterGuard, AnyTokenGuard],
})
export class AuthModule {}
