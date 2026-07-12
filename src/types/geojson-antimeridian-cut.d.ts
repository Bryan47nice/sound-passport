declare module 'geojson-antimeridian-cut' {
  import type { GeoJsonObject } from 'geojson';

  function splitGeoJSON(object: GeoJsonObject): GeoJsonObject;

  export = splitGeoJSON;
}
