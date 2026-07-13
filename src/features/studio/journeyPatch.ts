import type { Journey } from '../../domain/model';

export const journeyUserPatchKeys = [
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

export type JourneyUserPatchKey = typeof journeyUserPatchKeys[number];

export type JourneyUserPatch = Partial<Pick<Journey, JourneyUserPatchKey>>;

export interface JourneyPatchEnvelope {
  patch: JourneyUserPatch;
  base: JourneyUserPatch;
}

export class JourneyPatchConflictError extends Error {
  constructor() {
    super('Journey fields changed after editing began.');
    this.name = 'JourneyPatchConflictError';
  }
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function copyValue<T>(value: T): T {
  return (Array.isArray(value) ? [...value] : value) as T;
}

function assignValue(target: JourneyUserPatch, key: JourneyUserPatchKey, value: Journey[JourneyUserPatchKey]) {
  Object.assign(target, { [key]: copyValue(value) });
}

function sameValue(left: Journey[JourneyUserPatchKey], right: Journey[JourneyUserPatchKey]) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

export function createJourneyPatchEnvelope(draft: Journey, requestedPatch: JourneyUserPatch): JourneyPatchEnvelope {
  const patch: JourneyUserPatch = {};
  const base: JourneyUserPatch = {};

  journeyUserPatchKeys.forEach((key) => {
    if (!hasOwn(requestedPatch, key)) return;
    assignValue(patch, key, requestedPatch[key] as Journey[JourneyUserPatchKey]);
    assignValue(base, key, draft[key]);
  });

  return { patch, base };
}

export function mergeJourneyPatchEnvelopes(
  current: JourneyPatchEnvelope,
  next: JourneyPatchEnvelope,
): JourneyPatchEnvelope {
  const patch: JourneyUserPatch = {};
  const base: JourneyUserPatch = {};

  journeyUserPatchKeys.forEach((key) => {
    if (hasOwn(current.patch, key)) {
      assignValue(patch, key, current.patch[key] as Journey[JourneyUserPatchKey]);
      assignValue(base, key, current.base[key] as Journey[JourneyUserPatchKey]);
    }
    if (hasOwn(next.patch, key)) {
      assignValue(patch, key, next.patch[key] as Journey[JourneyUserPatchKey]);
      if (!hasOwn(current.patch, key)) {
        assignValue(base, key, next.base[key] as Journey[JourneyUserPatchKey]);
      }
    }
  });

  return { patch, base };
}

export function journeyPatchBaseMatches(envelope: JourneyPatchEnvelope, persisted: Journey) {
  return journeyUserPatchKeys.every((key) => (
    !hasOwn(envelope.patch, key) ||
    sameValue(envelope.base[key] as Journey[JourneyUserPatchKey], persisted[key])
  ));
}

export function journeyPatchMatchesPersisted(envelope: JourneyPatchEnvelope, persisted: Journey) {
  return journeyUserPatchKeys.every((key) => (
    !hasOwn(envelope.patch, key) ||
    sameValue(envelope.patch[key] as Journey[JourneyUserPatchKey], persisted[key])
  ));
}
