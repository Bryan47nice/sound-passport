import countriesTopology from 'world-atlas/countries-110m.json';
import splitGeoJSON from 'geojson-antimeridian-cut';
import { feature } from 'topojson-client';
import type { FeatureCollection, Geometry, Position } from 'geojson';
import type { Topology } from 'topojson-specification';
import type { StyleSpecification } from 'maplibre-gl';

function isFeatureCollection(value: unknown): value is FeatureCollection<Geometry> {
  return typeof value === 'object' && value !== null
    && (value as { type?: unknown }).type === 'FeatureCollection';
}

function isAntimeridian(longitude: number) {
  return Math.abs(Math.abs(longitude) - 180) < 1e-9;
}

function normalizeDegenerateAntimeridianEdge(ring: Position[]) {
  return ring.map((position, index) => {
    const previous = ring[index - 1];
    if (!previous || !isAntimeridian(position[0]) || !isAntimeridian(previous[0])) return position;
    return Math.abs(position[0] - previous[0]) > 180 ? [previous[0], ...position.slice(1)] : position;
  });
}

function hasLongitudeJump(ring: Position[]) {
  return ring.some((position, index) => (
    index > 0 && Math.abs(position[0] - ring[index - 1][0]) > 180
  ));
}

function rotateRingAwayFromAntimeridian(ring: Position[]) {
  if (!hasLongitudeJump(ring)) return ring;
  const openRing = ring.slice(0, -1);
  const start = openRing.findIndex((position) => !isAntimeridian(position[0]));
  if (start < 0) return ring;
  const rotated = [...openRing.slice(start), ...openRing.slice(0, start)];
  return [...rotated, rotated[0]];
}

function prepareRingForCut(ring: Position[]) {
  return rotateRingAwayFromAntimeridian(normalizeDegenerateAntimeridianEdge(ring));
}

function prepareGeometryForCut(geometry: Geometry): Geometry {
  if (geometry.type === 'Polygon') {
    return { ...geometry, coordinates: geometry.coordinates.map(prepareRingForCut) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) => polygon.map(prepareRingForCut)),
    };
  }
  if (geometry.type === 'GeometryCollection') {
    return { ...geometry, geometries: geometry.geometries.map(prepareGeometryForCut) };
  }
  return geometry;
}

function prepareCountriesForCut(countries: FeatureCollection<Geometry>): FeatureCollection<Geometry> {
  return {
    ...countries,
    features: countries.features.map((country) => ({
      ...country,
      geometry: prepareGeometryForCut(country.geometry),
    })),
  };
}

const convertedCountries = feature(
  countriesTopology as unknown as Topology,
  'countries',
);

if (!isFeatureCollection(convertedCountries)) {
  throw new Error('Natural Earth countries must convert to a FeatureCollection');
}

const cutCountries = splitGeoJSON(prepareCountriesForCut(convertedCountries));

if (!isFeatureCollection(cutCountries)) {
  throw new Error('Cut Natural Earth countries must remain a FeatureCollection');
}

const countries = cutCountries;

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
