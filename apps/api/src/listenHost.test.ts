import { describe, expect, it } from 'vitest';
import { listenHost } from './listenHost.js';

describe('listenHost', () => {
  it('listens on this machine alone outside production', () => {
    expect(listenHost({})).toBe('127.0.0.1');
    expect(listenHost({ NODE_ENV: 'development' })).toBe('127.0.0.1');
  });

  it('listens on every interface in production', () => {
    expect(listenHost({ NODE_ENV: 'production' })).toBeUndefined();
  });

  it('listens where HOST says, when set', () => {
    expect(listenHost({ HOST: '192.168.4.22' })).toBe('192.168.4.22');
    expect(listenHost({ NODE_ENV: 'production', HOST: '0.0.0.0' })).toBe(
      '0.0.0.0',
    );
  });
});
