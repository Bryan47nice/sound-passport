import { describe, expect, expectTypeOf, it } from 'vitest';
import { formatLocalDateTime } from './dateTime';

describe('formatLocalDateTime', () => {
  it('accepts only explicit local wall-clock fields', () => {
    expectTypeOf(formatLocalDateTime).toEqualTypeOf<(localDate: string, localTime?: string) => string>();
  });

  it('formats recorded local wall-clock fields without time-zone conversion', () => {
    expect(formatLocalDateTime('2024-10-03', '21:42')).toBe('2024.10.03 · 21:42');
  });

  it('renders a date without a time when no local time was recorded', () => {
    expect(formatLocalDateTime('2024-10-03')).toBe('2024.10.03');
  });

  it('does not derive a time from a timestamp-shaped date value', () => {
    expect(formatLocalDateTime('2024-10-03T21:42:00+09:00')).toBe('2024.10.03');
  });
});
