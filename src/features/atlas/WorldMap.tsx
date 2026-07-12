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

function markerOffsetForWidth(countryCode: string, containerWidth: number): [number, number] {
  if (!worldCameraForWidth(containerWidth).isNarrow) return [0, 0];
  if (countryCode === 'JP') return [0, 18];
  if (countryCode === 'KR') return [0, -18];
  return [0, 0];
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
    const initialWidth = container.clientWidth;
    const { camera } = worldCameraForWidth(initialWidth);
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

      const marker = new maplibregl.Marker({
        element: button,
        offset: markerOffsetForWidth(country.countryCode, initialWidth),
      })
        .setLngLat(country.coordinates)
        .addTo(map);

      return { country, marker };
    });
    let observedWidth = container.clientWidth;
    let observedHeight = container.clientHeight;
    const resizeObserver = new ResizeObserver((entries) => {
      if (disposed) return;
      const entry = entries.find(({ target }) => target === container);
      if (!entry) return;

      const { width, height } = entry.contentRect;
      if (width === observedWidth && height === observedHeight) return;
      observedWidth = width;
      observedHeight = height;
      container.dataset.mapReady = 'false';
      map.resize();
      map.jumpTo(worldCameraForWidth(width).camera);
      markers.forEach(({ country, marker }) => marker.setOffset(markerOffsetForWidth(country.countryCode, width)));
    });
    resizeObserver.observe(container);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      map.off('render', updateReadiness);
      if (readinessFrame !== undefined) cancelAnimationFrame(readinessFrame);
      delete container.dataset.mapReady;
      markers.forEach(({ marker }) => marker.remove());
      map.remove();
    };
  }, [countries]);

  return <div className="world-map" ref={containerRef} aria-label="旅行世界地圖" />;
}
