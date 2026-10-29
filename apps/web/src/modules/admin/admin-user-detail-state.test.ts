import { describe, expect, it } from 'vitest';

import { ApiError } from '@/shared/lib/api-client';

import { getAdminUserDetailState } from './admin-user-detail-state';
import type { AdminUserDetail } from './types';

const DETAIL = { id: 'u-1', name: 'An' } as AdminUserDetail;

describe('getAdminUserDetailState', () => {
  it('chưa có gì và chưa lỗi -> đang tải', () => {
    expect(getAdminUserDetailState({ data: undefined, isError: false, error: null })).toEqual({
      status: 'pending',
    });
  });

  it('có dữ liệu -> hiện dữ liệu', () => {
    expect(getAdminUserDetailState({ data: DETAIL, isError: false, error: null })).toEqual({
      status: 'success',
      user: DETAIL,
    });
  });

  it('có dữ liệu mà lần tải lại ngầm lỗi -> VẪN hiện dữ liệu (không xoá chi tiết đang xem)', () => {
    expect(
      getAdminUserDetailState({ data: DETAIL, isError: true, error: new Error('network') }),
    ).toEqual({ status: 'success', user: DETAIL });
  });

  it('404 -> không tìm thấy (kết quả chắc chắn, không mời "thử lại")', () => {
    expect(
      getAdminUserDetailState({
        data: undefined,
        isError: true,
        error: new ApiError('x', 404, 'USER_NOT_FOUND'),
      }),
    ).toEqual({ status: 'not-found' });
  });

  it.each([401, 403, 500, 503])('lỗi %i -> lỗi có thể thử lại', (status) => {
    expect(
      getAdminUserDetailState({ data: undefined, isError: true, error: new ApiError('x', status) }),
    ).toEqual({ status: 'error' });
  });

  it('lỗi mạng / lỗi không phải ApiError -> lỗi có thể thử lại', () => {
    expect(
      getAdminUserDetailState({ data: undefined, isError: true, error: new TypeError('fetch') }),
    ).toEqual({ status: 'error' });
  });
});
