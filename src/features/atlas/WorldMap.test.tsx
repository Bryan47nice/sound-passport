import { act, fireEvent, render } from '@testing-library/react';
import { Suspense, startTransition, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CountrySummary } from '../../domain/model';
import { atlasStyle } from './atlasStyle';
import { WorldMap } from './WorldMap';

const maplibreMocks = vi.hoisted(() => ({
  maps: [] as Array<{
    emitRender: (loaded: boolean, tilesLoaded: boolean) => void;
    emitIdle: () => void;
    emitLoad: () => void;
    fitBounds: ReturnType<typeof vi.fn>;
    jumpTo: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    options: { center?: [number, number]; minZoom?: number; style?: unknown; zoom?: number };
    remove: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
  }>,
  markers: [] as Array<{
    addTo: ReturnType<typeof vi.fn>;
    element: HTMLElement;
    offset?: [number, number];
    remove: ReturnType<typeof vi.fn>;
    setLngLat: ReturnType<typeof vi.fn>;
    setOffset: ReturnType<typeof vi.fn>;
  }>,
}));

const animationFrames = vi.hoisted(() => {
  let nextId = 0;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => {
    const id = ++nextId;
    callbacks.set(id, callback);
    return id;
  });
  const cancel = vi.fn((id: number) => {
    callbacks.delete(id);
  });

  return {
    cancel,
    callbacks,
    request,
    reset: () => {
      nextId = 0;
      callbacks.clear();
      request.mockClear();
      cancel.mockClear();
    },
    run: (id: number) => callbacks.get(id)?.(0),
  };
});

const resizeObserverMocks = vi.hoisted(() => ({
  observers: [] as Array<{
    disconnect: ReturnType<typeof vi.fn>;
    emit: (width: number, height?: number) => void;
    observe: ReturnType<typeof vi.fn>;
  }>,
  reset() {
    this.observers.length = 0;
  },
}));

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      private idleHandler?: () => void;
      private loadHandler?: () => void;
      private renderHandler?: () => void;
      private mapLoaded = false;
      private tilesLoaded = false;

      areTilesLoaded = vi.fn(() => this.tilesLoaded);
      emitIdle = () => {
        const handler = this.idleHandler;
        this.idleHandler = undefined;
        handler?.();
      };
      emitLoad = () => {
        const handler = this.loadHandler;
        this.loadHandler = undefined;
        handler?.();
      };
      emitRender = (loaded: boolean, tilesLoaded: boolean) => {
        this.mapLoaded = loaded;
        this.tilesLoaded = tilesLoaded;
        this.renderHandler?.();
      };
      fitBounds = vi.fn(() => this);
      jumpTo = vi.fn(() => this);
      loaded = vi.fn(() => this.mapLoaded);
      off = vi.fn((event: string, handler: () => void) => {
        if (event === 'idle' && this.idleHandler === handler) this.idleHandler = undefined;
        if (event === 'load' && this.loadHandler === handler) this.loadHandler = undefined;
        if (event === 'render' && this.renderHandler === handler) this.renderHandler = undefined;
        return this;
      });
      on = vi.fn((event: string, handler: () => void) => {
        if (event === 'render') this.renderHandler = handler;
        return this;
      });
      once = vi.fn((event: string, handler: () => void) => {
        if (event === 'idle') this.idleHandler = handler;
        if (event === 'load') this.loadHandler = handler;
        return this;
      });
      options: { center?: [number, number]; minZoom?: number; zoom?: number };
      remove = vi.fn();
      resize = vi.fn(() => this);

      constructor(options: { center?: [number, number]; minZoom?: number; style?: unknown; zoom?: number }) {
        this.options = options;
        maplibreMocks.maps.push(this);
      }
    },
    Marker: class {
      addTo = vi.fn(() => this);
      remove = vi.fn();
      setLngLat = vi.fn(() => this);
      setOffset = vi.fn(() => this);

      constructor({ element, offset }: { element: HTMLElement; offset?: [number, number] }) {
        maplibreMocks.markers.push(Object.assign(this, { element, offset }));
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
    animationFrames.reset();
    resizeObserverMocks.reset();
    vi.stubGlobal('requestAnimationFrame', animationFrames.request);
    vi.stubGlobal('cancelAnimationFrame', animationFrames.cancel);
    vi.stubGlobal('ResizeObserver', class {
      disconnect = vi.fn();
      observe = vi.fn();

      constructor(callback: ResizeObserverCallback) {
        resizeObserverMocks.observers.push({
          disconnect: this.disconnect,
          observe: this.observe,
          emit: (width, height = 0) => callback([{
            contentRect: { width, height },
            target: this.observe.mock.calls[0]?.[0],
          } as ResizeObserverEntry], this as unknown as ResizeObserver),
        });
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  it('exposes readiness only after render confirms loaded tiles and a frame', () => {
    const { container, unmount } = render(
      <WorldMap countries={countries} onCountrySelect={vi.fn()} />,
    );
    const mapElement = container.querySelector<HTMLElement>('.world-map');
    const map = maplibreMocks.maps[0];

    expect(mapElement).toHaveAttribute('data-map-ready', 'false');
    expect(map.on).toHaveBeenCalledWith('render', expect.any(Function));

    act(() => map.emitRender(false, false));
    expect(mapElement).toHaveAttribute('data-map-ready', 'false');
    expect(animationFrames.request).not.toHaveBeenCalled();
    act(() => map.emitRender(true, false));
    expect(mapElement).toHaveAttribute('data-map-ready', 'false');
    expect(animationFrames.request).not.toHaveBeenCalled();
    act(() => map.emitRender(true, true));
    expect(mapElement).toHaveAttribute('data-map-ready', 'false');
    expect(animationFrames.request).toHaveBeenCalledOnce();
    const frameId = [...animationFrames.callbacks.keys()][0];
    act(() => animationFrames.run(frameId));
    expect(mapElement).toHaveAttribute('data-map-ready', 'true');

    unmount();
    expect(map.off).toHaveBeenCalledWith('render', expect.any(Function));
    expect(mapElement).not.toHaveAttribute('data-map-ready');
  });

  it('cancels a pending readiness frame during cleanup', () => {
    const { container, unmount } = render(
      <WorldMap countries={countries} onCountrySelect={vi.fn()} />,
    );
    const mapElement = container.querySelector<HTMLElement>('.world-map');
    const map = maplibreMocks.maps[0];

    act(() => map.emitRender(true, true));
    const frameId = [...animationFrames.callbacks.keys()][0];
    unmount();

    expect(animationFrames.cancel).toHaveBeenCalledWith(frameId);
    expect(mapElement).not.toHaveAttribute('data-map-ready');
  });

  it('initializes a narrow map with a container-width-derived world camera', () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);

    render(<WorldMap countries={countries} onCountrySelect={vi.fn()} />);

    expect(maplibreMocks.maps[0].fitBounds).not.toHaveBeenCalled();
    expect(maplibreMocks.maps[0].options).toMatchObject({
      center: [50, 20],
      minZoom: 0,
      style: atlasStyle,
      zoom: 0,
    });
    expect(maplibreMocks.markers.map((marker) => marker.offset)).toEqual([[0, 18], [0, -18]]);
    expect(maplibreMocks.maps[0].jumpTo).not.toHaveBeenCalled();
    clientWidth.mockRestore();
  });

  it('caps the desktop camera zoom while retaining the global center', () => {
    const clientWidth = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1408);

    render(<WorldMap countries={countries} onCountrySelect={vi.fn()} />);

    expect(maplibreMocks.maps[0].options).toMatchObject({
      center: [0, 20],
      zoom: 1.1,
    });
    clientWidth.mockRestore();
  });

  it('reframes and repositions markers when its container resizes, then disconnects the observer', () => {
    let clientWidth = 358;
    const clientWidthSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => clientWidth);
    const { container, unmount } = render(
      <WorldMap countries={countries} onCountrySelect={vi.fn()} />,
    );
    const mapElement = container.querySelector<HTMLElement>('.world-map');
    const map = maplibreMocks.maps[0];
    const observer = resizeObserverMocks.observers[0];

    expect(observer.observe).toHaveBeenCalledWith(mapElement);
    expect(map.resize).not.toHaveBeenCalled();

    act(() => observer.emit(358));
    expect(map.jumpTo).not.toHaveBeenCalled();

    clientWidth = 1408;
    act(() => observer.emit(1408));

    expect(mapElement).toHaveAttribute('data-map-ready', 'false');
    expect(map.resize).toHaveBeenCalledOnce();
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [0, 20], zoom: 1.1 });
    expect(maplibreMocks.markers.map((marker) => marker.setOffset.mock.calls[0][0])).toEqual([[0, 0], [0, 0]]);

    act(() => map.emitRender(true, true));
    const frameId = [...animationFrames.callbacks.keys()][0];
    act(() => animationFrames.run(frameId));
    expect(mapElement).toHaveAttribute('data-map-ready', 'true');

    unmount();
    expect(observer.disconnect).toHaveBeenCalledOnce();

    act(() => observer.emit(358));
    expect(map.resize).toHaveBeenCalledOnce();
    clientWidthSpy.mockRestore();
  });

  it('keeps the committed callback when a concurrent update is suspended', () => {
    const committedSelect = vi.fn();
    const uncommittedSelect = vi.fn();
    const pending = new Promise<never>(() => undefined);
    let suspendNextUpdate = () => undefined;

    function SuspendsForever(): never {
      throw pending;
    }

    function Harness() {
      const [state, setState] = useState({
        onCountrySelect: committedSelect,
        suspended: false,
      });
      suspendNextUpdate = () => {
        setState({ onCountrySelect: uncommittedSelect, suspended: true });
      };

      return (
        <Suspense fallback={<div>Loading</div>}>
          <WorldMap countries={countries} onCountrySelect={state.onCountrySelect} />
          {state.suspended ? <SuspendsForever /> : null}
        </Suspense>
      );
    }

    render(<Harness />);

    act(() => {
      startTransition(suspendNextUpdate);
    });
    fireEvent.click(maplibreMocks.markers[0].element);

    expect(committedSelect).toHaveBeenCalledWith('JP');
    expect(uncommittedSelect).not.toHaveBeenCalled();
    expect(maplibreMocks.maps).toHaveLength(1);
  });
});
