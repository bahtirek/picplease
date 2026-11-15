import type { NestFastifyApplication } from '@nestjs/platform-fastify';

type FastifyCorsOptions = NonNullable<Parameters<NestFastifyApplication['enableCors']>[0]>;

/** Only WEB_ORIGIN gets CORS headers. Requests without an Origin (native apps, curl) are unaffected. */
export function buildCorsOptions(webOrigin: string): FastifyCorsOptions {
  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow: boolean) => void) => {
      callback(null, origin === webOrigin);
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    credentials: false,
    maxAge: 600,
  };
}
