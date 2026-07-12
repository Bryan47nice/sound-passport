import { describe, expect, it } from 'vitest';
import { atlasStyle } from './atlasStyle';

describe('atlasStyle', () => {
  it('uses Natural Earth country features through a local GeoJSON source', () => {
    const source = atlasStyle.sources.countries;

    expect(source).toMatchObject({
      type: 'geojson',
      attribution: expect.stringContaining('Natural Earth'),
    });
    expect(source).toHaveProperty('data.type', 'FeatureCollection');
    expect(source).toHaveProperty('data.features.length');
    expect((source as { data: { features: unknown[] } }).data.features.length).toBeGreaterThan(150);
    expect(JSON.stringify(atlasStyle)).not.toMatch(/https?:\/\//);
  });

  it('draws a colored country fill and visible country borders', () => {
    expect(atlasStyle.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'country-fill', type: 'fill', source: 'countries' }),
      expect.objectContaining({ id: 'country-borders', type: 'line', source: 'countries' }),
    ]));
  });
});
