import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './common/config/config';
import { HealthModule } from './health/health.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, extraImports: Type[] = []): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [HealthModule, ...extraImports],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
