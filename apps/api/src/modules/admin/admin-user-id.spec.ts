import { isUserId, isUuid } from './admin-user-id';
import { isUuid as isUuidShared } from '../../shared/utils/is-uuid';

const VALID = '3f2b8c1e-9d4a-4e6b-8a1c-0123456789ab';

// `isUuid` được chuyển vào shared/utils khi module `appeal` cũng cần; file này giữ re-export để các service admin không phải đổi import.
describe('admin-user-id', () => {
  it('xuất lại đúng hàm dùng chung (một nguồn sự thật duy nhất)', () => {
    expect(isUuid).toBe(isUuidShared);
  });

  it('isUserId nhận UUID và từ chối id sai dạng', () => {
    expect(isUserId(VALID)).toBe(true);
    expect(isUserId(`x${VALID}`)).toBe(false);
    expect(isUserId('')).toBe(false);
  });
});
