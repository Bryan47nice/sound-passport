import { describe, expect, it } from 'vitest';
import { experiencePath } from './JourneyExperienceContext';

describe('experiencePath', () => {
  it.each([
    ['', '/countries/JP', '/countries/JP'],
    ['/demo', '/countries/JP', '/demo/countries/JP'],
    ['/demo', '', '/demo'],
  ] as const)('keeps %s and %s as %s', (prefix, path, expected) => {
    expect(experiencePath(prefix, path)).toBe(expected);
  });
});
