import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Dùng cho GET /auth/google (redirect người dùng sang Google) và
// GET /auth/google/callback (Google redirect lại, guard verify code +
// gọi GoogleStrategy.validate(), set req.user = GoogleProfile).
@Injectable()
export class GoogleAuthGuard extends AuthGuard('google') {}
