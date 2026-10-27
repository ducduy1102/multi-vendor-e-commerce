import { PrismaClient } from '@prisma/client';
import { parse } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  describeCleanupOutcome,
  readSuiteStart,
  resolveDatabaseUrl,
  runAdminNotificationCleanup,
} from '../src/shared/testing/admin-notification-cleanup';

// Jest globalTeardown (cho `test:int` và `test:e2e`): dọn thông báo tới Admin do lượt chạy này để lại (Week11.md 2.1,
// D19). Logic và các chốt an toàn (chỉ DB localhost, không bao giờ ném) nằm ở shared/testing/admin-notification-cleanup.ts
// để unit test được; đây chỉ là keo.

// Không nạp .env vào process.env (sẽ đổi môi trường của các test): chỉ đọc giá trị ra để biết Prisma sẽ nối tới đâu.
function readEnvFileValues(): Record<string, string | undefined> {
  try {
    return parse(readFileSync(resolve(__dirname, '../.env')));
  } catch {
    return {};
  }
}

export default async function globalTeardown(): Promise<void> {
  const outcome = await runAdminNotificationCleanup({
    databaseUrl: resolveDatabaseUrl(process.env, readEnvFileValues()),
    since: readSuiteStart(),
    createClient: (datasourceUrl) => new PrismaClient({ datasourceUrl }),
  });
  const message = describeCleanupOutcome(outcome);
  if (message) {
    if (outcome.status === 'cleaned') console.info(message);
    else console.warn(message);
  }
}
