import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CountrySummary } from '../../domain/model';

export interface WorldMapProps {
  countries: CountrySummary[];
  onCountrySelect: (countryCode: string) => void;
}

export function WorldMap({ countries, onCountrySelect }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCountrySelectRef = useRef(onCountrySelect);

  useEffect(() => {
    onCountrySelectRef.current = onCountrySelect;
  }, [onCountrySelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://demotiles.maplibre.org/globe.json',
      center: [20, 20],
      zoom: 1.1,
    });
    const markers = countries.map((country) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'country-marker';
      button.textContent = String(country.journeyCount);
      button.setAttribute('aria-label', `${country.countryName}，${country.journeyCount} 趟旅程`);
      button.addEventListener('click', () => onCountrySelectRef.current(country.countryCode));

      return new maplibregl.Marker({ element: button })
        .setLngLat(country.coordinates)
        .addTo(map);
    });

    return () => {
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [countries]);

  return <div className="world-map" ref={containerRef} aria-label="旅行世界地圖" />;
}
