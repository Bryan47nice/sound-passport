import type { Journey } from '../../domain/model';
import type {
  JourneyAutosaveOutboxPort,
  JourneyAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyPatchEnvelope, JourneyUserPatch } from './journeyPatch';

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

function copyPatchValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
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
    Object.assign(patch, {
      [key]: copyPatchValue(patchValue === null ? undefined : patchValue) as Journey[PatchKey],
    });
    Object.assign(base, {
      [key]: copyPatchValue(baseValue === null ? undefined : baseValue) as Journey[PatchKey],
    });
  }

  return Object.keys(patch).length > 0 ? { patch, base } : undefined;
}

function normalizeRecord(
  value: unknown,
  expectedJourneyId?: string,
): JourneyAutosaveOutboxRecord | undefined {
  if (!isRecord(value)) return undefined;
  const { journeyId, generation, updatedAt } = value;
  const envelope = normalizeEnvelope(value.envelope);
  if (
    typeof journeyId !== 'string' || journeyId.length === 0 ||
    (expectedJourneyId !== undefined && journeyId !== expectedJourneyId) ||
    typeof generation !== 'string' || generation.length === 0 ||
    typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt)) ||
    !envelope
  ) return undefined;

  return { journeyId, generation, envelope, updatedAt };
}

export async function readJourneyOutbox(
  outbox: JourneyAutosaveOutboxPort,
  journeyId: string,
) {
  return normalizeRecord(await outbox.get(journeyId), journeyId);
}

export async function writeJourneyOutbox(
  outbox: JourneyAutosaveOutboxPort,
  record: JourneyAutosaveOutboxRecord,
) {
  const normalized = normalizeRecord(record, record.journeyId);
  if (!normalized) throw new TypeError('Journey autosave outbox record is invalid.');
  await outbox.put(normalized);
}

export function clearJourneyOutbox(
  outbox: JourneyAutosaveOutboxPort,
  journeyId: string,
  generation: string,
) {
  return outbox.compareAndDelete(journeyId, generation);
}
