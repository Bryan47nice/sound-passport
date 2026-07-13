import { describe, expect, it } from 'vitest';
import { findCountry, listCountries } from './countryCatalog';

describe('countryCatalog', () => {
  it('returns every country with a zh-TW label and MapLibre coordinate order', () => {
    const countries = listCountries();
    expect(countries.length).toBeGreaterThan(190);
    expect(countries.every((country) => country.code.length === 2)).toBe(true);
    expect(findCountry('JP')).toMatchObject({ code: 'JP', name: '日本' });
    expect(findCountry('JP')?.coordinates[0]).toBeGreaterThan(120);
    expect(findCountry('JP')?.coordinates[1]).toBeGreaterThan(20);
  });
});
