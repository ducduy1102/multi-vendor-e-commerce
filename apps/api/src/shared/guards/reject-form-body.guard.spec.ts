import {
  ExecutionContext,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { RejectFormBodyGuard } from './reject-form-body.guard';

describe('RejectFormBodyGuard', () => {
  const guard = new RejectFormBodyGuard();
  const contextOf = (
    method: string,
    contentType: string | undefined,
    type = 'http',
  ) => {
    const getRequest = jest.fn(() => ({
      method,
      headers: contentType === undefined ? {} : { 'content-type': contentType },
    }));
    const context = {
      getType: () => type,
      switchToHttp: () => ({ getRequest }),
    } as unknown as ExecutionContext;
    return { context, getRequest };
  };
  const run = (method: string, contentType?: string) =>
    guard.canActivate(contextOf(method, contentType).context);

  describe('lệnh ghi mang body dạng form ⇒ 415', () => {
    const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE'];
    const FORM_TYPES = [
      'application/x-www-form-urlencoded',
      'multipart/form-data; boundary=----WebKitFormBoundaryabc',
      'text/plain',
    ];

    it.each(WRITES.flatMap((m) => FORM_TYPES.map((t) => [m, t] as const)))(
      '%s với %s',
      (method, contentType) => {
        expect(() => run(method, contentType)).toThrow(
          UnsupportedMediaTypeException,
        );
      },
    );

    it.each([
      ['viết hoa', 'APPLICATION/X-WWW-FORM-URLENCODED'],
      ['hỗn hợp hoa thường', 'Multipart/Form-Data; boundary=x'],
      ['kèm charset', 'application/x-www-form-urlencoded; charset=UTF-8'],
      ['kèm khoảng trắng quanh', '  text/plain ; charset=utf-8'],
      ['không có dấu cách trước tham số', 'text/plain;charset=UTF-8'],
    ])('nhận ra dù %s', (_name, contentType) => {
      expect(() => run('POST', contentType)).toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it('phương thức viết thường cũng được nhận ra', () => {
      expect(() => run('post', 'text/plain')).toThrow(
        UnsupportedMediaTypeException,
      );
    });

    it('trả đúng status 415 và thông điệp không lộ chi tiết', () => {
      try {
        run('POST', 'text/plain');
        throw new Error('phải ném');
      } catch (error) {
        const exception = error as UnsupportedMediaTypeException;
        expect(exception.getStatus()).toBe(415);
        expect(exception.message).toBe(
          'Only application/json request bodies are accepted',
        );
      }
    });
  });

  describe('được cho qua', () => {
    it.each([
      ['application/json'],
      ['application/json; charset=utf-8'],
      ['APPLICATION/JSON'],
      ['application/octet-stream'],
      ['application/x-ndjson'],
      ['application/json-patch+json'],
      [undefined], // không có body (vd POST /read, /logout) ⇒ không có Content-Type
      [''],
    ])('POST với Content-Type %p', (contentType) => {
      expect(run('POST', contentType)).toBe(true);
    });

    it.each(['GET', 'HEAD', 'OPTIONS'])(
      '%s với loại form vẫn qua (không phải lệnh ghi)',
      (method) => {
        expect(run(method, 'application/x-www-form-urlencoded')).toBe(true);
      },
    );

    it('các loại gần giống nhưng KHÔNG phải ba loại bị chặn', () => {
      for (const contentType of [
        'application/x-www-form-urlencoded-x',
        'multipart/mixed',
        'text/plainx',
        'text/html',
      ]) {
        expect(run('POST', contentType)).toBe(true);
      }
    });
  });

  it('ngữ cảnh KHÔNG phải HTTP (WebSocket, RPC) ⇒ cho qua và không đụng tới request', () => {
    for (const type of ['ws', 'rpc']) {
      const { context, getRequest } = contextOf('POST', 'text/plain', type);

      expect(guard.canActivate(context)).toBe(true);
      expect(getRequest).not.toHaveBeenCalled();
    }
  });
});
