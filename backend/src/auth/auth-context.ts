import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

export type SessionRole = 'helper' | 'requester';

/** What a guard attaches to the request after a token checks out. */
export interface AuthContext {
  sessionId: string;
  role: SessionRole;
}

export type AuthenticatedRequest = FastifyRequest & { auth?: AuthContext };

/** Controller parameter: `@Auth() auth: AuthContext`. Only use behind a guard. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthContext => {
  const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error('@Auth() used on a route without an auth guard');
  return auth;
});
