import { type DynamicModule, Module, type Type } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './common/config/config';
import { DatabaseModule } from './database/database.module';
import { DeliveryModule } from './delivery/delivery.module';
import { HealthModule } from './health/health.module';
import { RealtimeModule } from './realtime/realtime.module';
import { SessionsModule } from './sessions/sessions.module';
import { UploadsModule } from './uploads/uploads.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, extraImports: Type[] = []): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        DatabaseModule,
        HealthModule,
        SessionsModule,
        UploadsModule,
        DeliveryModule,
        RealtimeModule,
        ...extraImports,
      ],
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
