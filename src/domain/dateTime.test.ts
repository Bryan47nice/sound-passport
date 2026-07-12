import { describe, expect, it } from 'vitest';
import { formatLocalDateTime } from './dateTime';

describe('formatLocalDateTime', () => {
  it('renders the moment in its recorded IANA time zone', () => {
    expect(formatLocalDateTime('2024-10-03T12:42:00Z', 'Asia/Tokyo')).toBe('2024.10.03 · 21:42');
  });
});
