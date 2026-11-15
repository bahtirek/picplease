import { createApp } from './app.factory';
import { ConfigError, loadConfig } from './common/config/config';

async function bootstrap(): Promise<void> {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }

  const app = await createApp(config);
  // Bind to loopback: Nginx is the only public entry point.
  await app.listen({ port: config.port, host: '127.0.0.1' });
}

void bootstrap();
