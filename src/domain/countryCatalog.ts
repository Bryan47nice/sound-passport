import countries from 'world-countries';

export interface CountryOption {
  code: string;
  name: string;
  coordinates: [number, number];
}

const displayNames = new Intl.DisplayNames('zh-TW', { type: 'region' });

const catalog = countries
  .filter((country) => country.cca2.length === 2 && country.latlng.length === 2)
  .map<CountryOption>((country) => Object.freeze({
    code: country.cca2,
    name: displayNames.of(country.cca2) ?? country.name.common,
    coordinates: [country.latlng[1], country.latlng[0]] as [number, number],
  }))
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-TW'));

Object.freeze(catalog);

const countryByCode = new Map(catalog.map((country) => [country.code, country]));

export function listCountries(): CountryOption[] {
  return catalog;
}

export function findCountry(code: string): CountryOption | undefined {
  return countryByCode.get(code.toUpperCase());
}
