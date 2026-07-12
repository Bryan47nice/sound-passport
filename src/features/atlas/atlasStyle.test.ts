import { describe, expect, it } from 'vitest';
import type { Geometry, Position } from 'geojson';
import { atlasStyle } from './atlasStyle';

function polygonRings(geometry: Geometry | null): Position[][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates;
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat();
  if (geometry.type === 'GeometryCollection') return geometry.geometries.flatMap(polygonRings);
  return [];
}

describe('atlasStyle', () => {
  it('uses Natural Earth country features through a local GeoJSON source', () => {
    const source = atlasStyle.sources.countries;

    expect(source).toMatchObject({
      type: 'geojson',
      attribution: expect.stringContaining('Natural Earth'),
    });
    expect(source).toHaveProperty('data.type', 'FeatureCollection');
    expect(source).toHaveProperty('data.features.length');
    const countries = (source as { data: { features: Array<{ geometry: Geometry | null; properties: unknown }> } }).data;
    expect(countries.features).toHaveLength(177);
    expect(countries.features.every((country) => (
      typeof country.properties === 'object' && country.properties !== null
      && 'name' in country.properties
    ))).toBe(true);
    for (const country of countries.features) {
      for (const ring of polygonRings(country.geometry)) {
        for (let index = 1; index < ring.length; index += 1) {
          expect(Math.abs(ring[index][0] - ring[index - 1][0])).toBeLessThanOrEqual(180);
        }
      }
    }
    expect(JSON.stringify(atlasStyle)).not.toMatch(/https?:\/\//);
  });

  it('draws a colored country fill and visible country borders', () => {
    expect(atlasStyle.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'country-fill', type: 'fill', source: 'countries' }),
      expect.objectContaining({ id: 'country-borders', type: 'line', source: 'countries' }),
    ]));
  });
});
