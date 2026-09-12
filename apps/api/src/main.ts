import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
} from './modules/auth/auth.constants';
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

  // DTO validate bằng Zod (không phải class-validator) nên @nestjs/swagger
  // không tự suy ra schema từ class được — mỗi route tự khai @ApiBody/
  // @ApiResponse thủ công (xem auth.controller.ts).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('E-commerce Multi-Vendor API')
    .setDescription('API docs — bắt đầu từ module auth (Tuần 2)')
    .setVersion('0.1')
    .addCookieAuth(
      ACCESS_TOKEN_COOKIE,
      { type: 'apiKey', in: 'cookie' },
      ACCESS_TOKEN_COOKIE,
    )
    .addCookieAuth(
      REFRESH_TOKEN_COOKIE,
      { type: 'apiKey', in: 'cookie' },
      REFRESH_TOKEN_COOKIE,
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT?.trim() || 3000);
}
void bootstrap();
