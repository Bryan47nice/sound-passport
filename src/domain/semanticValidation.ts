export function isCanonicalRouteId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value);
}

export function isStrictLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function isStrictLocalTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isCanonicalTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

export function hasValidCoordinates(coordinates: readonly number[]): boolean {
  return coordinates.length === 2
    && Number.isFinite(coordinates[0])
    && Number.isFinite(coordinates[1])
    && coordinates[0] >= -180
    && coordinates[0] <= 180
    && coordinates[1] >= -90
    && coordinates[1] <= 90;
}
