import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

// Không set secret/expiresIn mặc định ở đây — access token và refresh token
// dùng 2 secret khác nhau, truyền riêng qua SignOptions mỗi lần gọi
// jwtService.signAsync() trong AuthService.issueTokens().
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService],
})
export class AuthModule {}
