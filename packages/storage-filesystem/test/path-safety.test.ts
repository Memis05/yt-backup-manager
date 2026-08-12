import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { archiveFolderName, resolvePathUnderRoot, sanitizeWindowsComponent } from '../src';

describe('Windows-safe archive paths', () => {
  it.each([
    ['../escape', '.._escape'],
    ['CON', '_CON'],
    ['NUL.txt', '_NUL.txt'],
    ['AUX.', '_AUX'],
    ['COM¹.txt', '_COM¹.txt'],
    ['LPT³', '_LPT³'],
    ['a<b>:c"d/e\\f|g?h*i', 'a_b__c_d_e_f_g_h_i'],
    ['quoted & calc.exe | title', 'quoted & calc.exe _ title'],
    ['Unicode 🚀 日本語', 'Unicode 🚀 日本語'],
  ])('sanitizes %j deterministically', (input, expected) => {
    expect(sanitizeWindowsComponent(input)).toBe(expected);
  });

  it('bounds long titles while retaining a stable provider ID and collision identity', () => {
    const first = archiveFolderName('x'.repeat(500), 'abc123', 80);
    const second = archiveFolderName('x'.repeat(500), 'def456', 80);
    expect(first.length).toBeLessThanOrEqual(80);
    expect(first.endsWith(' [abc123]')).toBe(true);
    expect(second.endsWith(' [def456]')).toBe(true);
    expect(first).not.toBe(second);
  });

  it('bounds supplementary Unicode by Windows UTF-16 code units without splitting a pair', () => {
    const value = sanitizeWindowsComponent('\u{1f680}'.repeat(200), 119);
    expect(value.length).toBeLessThanOrEqual(119);
    expect(value.endsWith('\ud83d')).toBe(false);
  });

  it('rejects path traversal and absolute paths', () => {
    const root = resolve('safe-root');
    expect(() => resolvePathUnderRoot(root, '..\\outside.txt')).toThrow(/escapes/);
    expect(() => resolvePathUnderRoot(root, resolve(root, 'absolute.txt'))).toThrow(/relative/);
    expect(resolvePathUnderRoot(root, 'Videos\\safe\\video.mp4')).toContain('video.mp4');
  });
});
