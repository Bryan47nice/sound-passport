import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CountrySummary } from '../../domain/model';
import { WorldMap } from './WorldMap';

const maplibreMocks = vi.hoisted(() => ({
  maps: [] as Array<{ remove: ReturnType<typeof vi.fn> }>,
  markers: [] as Array<{
    addTo: ReturnType<typeof vi.fn>;
    element: HTMLElement;
    remove: ReturnType<typeof vi.fn>;
    setLngLat: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      remove = vi.fn();

      constructor() {
        maplibreMocks.maps.push(this);
      }
    },
    Marker: class {
      addTo = vi.fn(() => this);
      remove = vi.fn();
      setLngLat = vi.fn(() => this);

      constructor({ element }: { element: HTMLElement }) {
        maplibreMocks.markers.push(Object.assign(this, { element }));
      }
    },
  },
}));

const countries: CountrySummary[] = [
  {
    countryCode: 'JP',
    countryName: '日本',
    coordinates: [138, 36],
    journeyCount: 2,
    latestJourneyTitle: '東京散步',
  },
  {
    countryCode: 'KR',
    countryName: '韓國',
    coordinates: [128, 36],
    journeyCount: 1,
    latestJourneyTitle: '首爾夜晚',
  },
];

describe('WorldMap', () => {
  beforeEach(() => {
    maplibreMocks.maps.length = 0;
    maplibreMocks.markers.length = 0;
  });

  it('keeps the map stable across callback updates and cleans up MapLibre resources', () => {
    const firstSelect = vi.fn();
    const latestSelect = vi.fn();
    const { rerender, unmount } = render(
      <WorldMap countries={countries} onCountrySelect={firstSelect} />,
    );

    expect(maplibreMocks.maps).toHaveLength(1);
    expect(maplibreMocks.markers).toHaveLength(2);

    rerender(<WorldMap countries={countries} onCountrySelect={latestSelect} />);
    fireEvent.click(maplibreMocks.markers[0].element);

    expect(maplibreMocks.maps).toHaveLength(1);
    expect(firstSelect).not.toHaveBeenCalled();
    expect(latestSelect).toHaveBeenCalledWith('JP');

    unmount();

    expect(maplibreMocks.markers.every((marker) => marker.remove.mock.calls.length === 1)).toBe(true);
    expect(maplibreMocks.maps[0].remove).toHaveBeenCalledOnce();
  });
});
