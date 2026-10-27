import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AdminAuditModule } from './admin-audit.module';
import { AdminAuditService } from './admin-audit.service';

// Module nghiệp vụ import AdminAuditModule rồi inject AdminAuditService (Week11.md 2.3): thiếu `exports` thì Nest không
// resolve được ở module tiêu thụ. Dùng module tiêu thụ thật thay vì `moduleRef.get` (mặc định không-strict, tìm được
// provider ở bất kỳ module nào nên không chứng minh được việc export).
@Injectable()
class Consumer {
  constructor(readonly audit: AdminAuditService) {}
}

@Module({ imports: [AdminAuditModule], providers: [Consumer] })
class ConsumerModule {}

describe('AdminAuditModule', () => {
  it('export AdminAuditService cho module import nó, không cần phụ thuộc nào khác', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConsumerModule],
    }).compile();

    expect(moduleRef.get(Consumer).audit).toBeInstanceOf(AdminAuditService);

    await moduleRef.close();
  });
});
