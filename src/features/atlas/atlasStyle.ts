import countriesTopology from 'world-atlas/countries-110m.json';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { StyleSpecification } from 'maplibre-gl';

function isFeatureCollection(value: unknown): value is FeatureCollection<Geometry> {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'FeatureCollection';
}

const convertedCountries = feature(
  countriesTopology as unknown as Topology,
  'countries',
);

if (!isFeatureCollection(convertedCountries)) {
  throw new Error('Natural Earth countries must convert to a FeatureCollection');
}

const countries = convertedCountries;

export const atlasStyle = {
  version: 8,
  name: 'Natural Earth atlas',
  sources: {
    countries: {
      type: 'geojson',
      data: countries,
      attribution: 'Natural Earth country boundaries (public domain) via world-atlas',
    },
  },
  layers: [
    {
      id: 'atlas-water',
      type: 'background',
      paint: { 'background-color': '#c9e9ef' },
    },
    {
      id: 'country-fill',
      type: 'fill',
      source: 'countries',
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['to-number', ['id']],
          0, '#edb95a',
          250, '#d76d76',
          500, '#659f9a',
          750, '#7676ba',
          1000, '#db8b54',
        ],
        'fill-opacity': 0.88,
      },
    },
    {
      id: 'country-borders',
      type: 'line',
      source: 'countries',
      paint: {
        'line-color': '#fff8eb',
        'line-width': 0.8,
        'line-opacity': 0.85,
      },
    },
  ],
} satisfies StyleSpecification;
