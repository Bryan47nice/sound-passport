import type { Journey } from '../../domain/model';
import type { JourneyPatchEnvelope, JourneyUserPatch } from './journeyPatch';

const storagePrefix = 'sound-passport.private.journey-outbox.v1:';
const patchKeys = [
  'title',
  'countryCode',
  'countryName',
  'countryCoordinates',
  'cityLabels',
  'startDate',
  'endDate',
  'summary',
  'coverPhotoAssetId',
] as const;

type PatchKey = typeof patchKeys[number];
type StoredPatch = Record<string, unknown>;

function storageKey(journeyId: string) {
  return `${storagePrefix}${encodeURIComponent(journeyId)}`;
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPatchValue(key: PatchKey, value: unknown) {
  if (key === 'countryCoordinates') {
    return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite);
  }
  if (key === 'cityLabels') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
  if (key === 'coverPhotoAssetId') return value === undefined || value === null || typeof value === 'string';
  return typeof value === 'string';
}

function copyPatchValue(value: unknown) {
  return Array.isArray(value) ? [...value] : value;
}

function normalizeEnvelope(value: unknown): JourneyPatchEnvelope | undefined {
  if (!isRecord(value) || !isRecord(value.patch) || !isRecord(value.base)) return undefined;
  const patch: JourneyUserPatch = {};
  const base: JourneyUserPatch = {};

  for (const key of patchKeys) {
    if (!hasOwn(value.patch, key)) continue;
    if (!hasOwn(value.base, key)) return undefined;
    const patchValue = value.patch[key];
    const baseValue = value.base[key];
    if (!isPatchValue(key, patchValue) || !isPatchValue(key, baseValue)) return undefined;
    Object.assign(patch, { [key]: copyPatchValue(patchValue === null ? undefined : patchValue) });
    Object.assign(base, { [key]: copyPatchValue(baseValue === null ? undefined : baseValue) });
  }

  return Object.keys(patch).length > 0 ? { patch, base } : undefined;
}

function encodePatch(patch: JourneyUserPatch): StoredPatch {
  const encoded: StoredPatch = {};
  patchKeys.forEach((key) => {
    if (!hasOwn(patch, key)) return;
    const value = patch[key] as Journey[PatchKey];
    encoded[key] = value === undefined ? null : copyPatchValue(value);
  });
  return encoded;
}

export function readJourneyOutbox(journeyId: string): JourneyPatchEnvelope | undefined {
  try {
    const serialized = sessionStorage.getItem(storageKey(journeyId));
    return serialized ? normalizeEnvelope(JSON.parse(serialized)) : undefined;
  } catch {
    return undefined;
  }
}

export function writeJourneyOutbox(journeyId: string, envelope: JourneyPatchEnvelope) {
  const normalized = normalizeEnvelope(envelope);
  if (!normalized) return;
  try {
    sessionStorage.setItem(storageKey(journeyId), JSON.stringify({
      patch: encodePatch(normalized.patch),
      base: encodePatch(normalized.base),
    }));
  } catch {
    // Autosave continues even when session storage is unavailable.
  }
}

export function clearJourneyOutbox(journeyId: string) {
  try {
    sessionStorage.removeItem(storageKey(journeyId));
  } catch {
    // There is nothing else to clear when session storage is unavailable.
  }
}
