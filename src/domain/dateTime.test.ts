import { describe, expect, it } from 'vitest';
import { formatLocalDateTime } from './dateTime';

describe('formatLocalDateTime', () => {
  it('formats recorded local wall-clock fields without time-zone conversion', () => {
    expect(formatLocalDateTime('2024-10-03', '21:42')).toBe('2024.10.03 · 21:42');
  });

  it('renders a date without a time when no local time was recorded', () => {
    expect(formatLocalDateTime('2024-10-03')).toBe('2024.10.03');
  });
});
