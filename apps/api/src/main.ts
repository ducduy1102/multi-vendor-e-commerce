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
import { readCorsOrigins } from './shared/utils/read-cors-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Version ngay từ endpoint đầu tiên (Tuần 3 Bước 1.5) — tránh phải đổi
  // toàn bộ client khi có breaking change sau này. SwaggerModule.setup('docs')
  // bên dưới không đi qua prefix này (route riêng do Swagger tự đăng ký).
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.enableCors({
    origin: readCorsOrigins(),
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
