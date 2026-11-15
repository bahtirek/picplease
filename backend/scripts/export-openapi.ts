import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { createApp } from '../src/app.factory';

// Generates the contract without starting a server or needing a real environment.
// No Swagger UI is mounted anywhere; the JSON file is the only output.
async function exportOpenApi(): Promise<void> {
  const app = await createApp(
    { nodeEnv: 'development', port: 0, webOrigin: 'https://picplease.app' },
    { silent: true },
  );
  await app.init();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('PicPlease API')
      .setVersion('0.1.0')
      .addServer('https://api.picplease.app')
      .addBearerAuth()
      .build(),
  );

  // Compiled to dist/scripts/, so go up two levels to backend/.
  const outFile = join(__dirname, '..', '..', 'openapi.json');
  writeFileSync(outFile, JSON.stringify(document, null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${outFile}`);
}

void exportOpenApi();
