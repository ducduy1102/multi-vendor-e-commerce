import { recordSuiteStart } from '../src/shared/testing/admin-notification-cleanup';

// Jest globalSetup (cho `test:int` và `test:e2e`): ghi mốc bắt đầu cả bộ để global-teardown biết thông báo nào của Admin
// là do lượt chạy này sinh ra. Không đụng DB, không thể làm hỏng lượt test (Week11.md 2.1).
export default function globalSetup(): void {
  recordSuiteStart();
}
