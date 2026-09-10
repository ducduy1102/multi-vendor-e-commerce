import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './shared/filters/all-exceptions.filter';
import { TransformResponseInterceptor } from './shared/interceptors/transform-response.interceptor';

// Origin FE cho phép gọi kèm cookie (credentials) — CORS_ORIGIN có thể là
// nhiều origin cách nhau bởi dấu phẩy, vd khi `next dev` tự đổi cổng lúc 3000
// đã bị chiếm. Mặc định cho cả 2 cổng hay dùng ở local.
const DEFAULT_CORS_ORIGINS = ['http://localhost:3000', 'http://localhost:3001'];

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? DEFAULT_CORS_ORIGINS,
    credentials: true,
  });
  app.useGlobalInterceptors(new TransformResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
