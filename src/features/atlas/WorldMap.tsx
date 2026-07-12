import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { CountrySummary } from '../../domain/model';
import { atlasStyle } from './atlasStyle';

export interface WorldMapProps {
  countries: CountrySummary[];
  onCountrySelect: (countryCode: string) => void;
}

const WORLD_TILE_SIZE = 512;
const WORLD_HORIZONTAL_PADDING = 16;
const MIN_WORLD_ZOOM = 0;
const MAX_WORLD_ZOOM = 1.1;

function worldCameraForWidth(containerWidth: number) {
  const usableWidth = Math.max(1, containerWidth - WORLD_HORIZONTAL_PADDING * 2);
  const zoom = Math.log2(usableWidth / WORLD_TILE_SIZE);
  const clampedZoom = Math.min(MAX_WORLD_ZOOM, Math.max(MIN_WORLD_ZOOM, zoom));
  return {
    camera: {
      center: (zoom <= MIN_WORLD_ZOOM ? [50, 20] : [0, 20]) as [number, number],
      zoom: clampedZoom,
    },
    isNarrow: zoom <= MIN_WORLD_ZOOM,
  };
}

export function WorldMap({ countries, onCountrySelect }: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onCountrySelectRef = useRef(onCountrySelect);

  useEffect(() => {
    onCountrySelectRef.current = onCountrySelect;
  }, [onCountrySelect]);

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    container.dataset.mapReady = 'false';
    const { camera, isNarrow } = worldCameraForWidth(container.clientWidth);
    const map = new maplibregl.Map({
      container,
      style: atlasStyle,
      ...camera,
      minZoom: MIN_WORLD_ZOOM,
    });
    let disposed = false;
    let readinessFrame: number | undefined;
    const markMapReady = () => {
      readinessFrame = undefined;
      if (disposed || !container.isConnected || !map.loaded() || !map.areTilesLoaded()) return;
      container.dataset.mapReady = 'true';
    };
    const updateReadiness = () => {
      if (!map.loaded() || !map.areTilesLoaded() || readinessFrame !== undefined) return;
      readinessFrame = requestAnimationFrame(markMapReady);
    };
    map.on('render', updateReadiness);
    updateReadiness();
    const markers = countries.map((country) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'country-marker';
      button.textContent = String(country.journeyCount);
      button.setAttribute('aria-label', `${country.countryName}，${country.journeyCount} 趟旅程`);
      button.addEventListener('click', () => onCountrySelectRef.current(country.countryCode));

      const offset: [number, number] | undefined = isNarrow
        ? country.countryCode === 'JP' ? [0, 18] : country.countryCode === 'KR' ? [0, -18] : undefined
        : undefined;

      return new maplibregl.Marker({ element: button, offset })
        .setLngLat(country.coordinates)
        .addTo(map);
    });

    return () => {
      disposed = true;
      map.off('render', updateReadiness);
      if (readinessFrame !== undefined) cancelAnimationFrame(readinessFrame);
      delete container.dataset.mapReady;
      markers.forEach((marker) => marker.remove());
      map.remove();
    };
  }, [countries]);

  return <div className="world-map" ref={containerRef} aria-label="旅行世界地圖" />;
}
