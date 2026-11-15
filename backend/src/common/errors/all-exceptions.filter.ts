import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import { mapException } from './error-mapping';

/** Global filter: every error leaves the API as {code, message}. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly log: FastifyBaseLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const { status, body, unexpected } = mapException(exception);

    if (unexpected) {
      this.log.error(
        { err: exception, method: request.method, url: request.url },
        'unhandled error',
      );
    }

    void reply.status(status).header('content-type', 'application/json; charset=utf-8').send(body);
  }
}
