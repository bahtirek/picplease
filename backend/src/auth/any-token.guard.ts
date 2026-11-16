import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { AppError } from '../common/errors';
import { HelperGuard } from './helper.guard';
import { RequesterGuard } from './requester.guard';

/**
 * Accepts either the requester or the helper token (each under its own state rules).
 * Fails with the same UNAUTHORIZED as the single-role guards.
 */
@Injectable()
export class AnyTokenGuard implements CanActivate {
  constructor(
    private readonly requester: RequesterGuard,
    private readonly helper: HelperGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      return await this.requester.canActivate(context);
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'UNAUTHORIZED') throw err;
    }
    return this.helper.canActivate(context);
  }
}
