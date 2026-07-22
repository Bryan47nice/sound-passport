import type { MomentAutosaveFieldPatchEnvelope } from '../../data/ports';
import type { JourneyMoment, MomentPatch } from '../../domain/model';

export type MomentPatchEnvelope = MomentAutosaveFieldPatchEnvelope;

const momentFields = [
  'localDate',
  'localTime',
  'cityLabel',
  'placeLabel',
  'caption',
  'reason',
  'reasonStatus',
  'photoAlt',
] as const;
const songFields = ['title', 'artist', 'sourceUrl'] as const;

export class MomentPatchConflictError extends Error {
  constructor(readonly remote: JourneyMoment, readonly fields: readonly string[]) {
    super('The moment changed remotely in one or more locally edited fields.');
    this.name = 'MomentPatchConflictError';
  }
}

export function createMomentPatchEnvelope(
  current: JourneyMoment,
  patch: MomentPatch,
): MomentPatchEnvelope {
  const base: MomentPatch = {};
  for (const field of momentFields) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      Object.assign(base, { [field]: current[field] });
    }
  }
  if (patch.song) {
    const song: NonNullable<MomentPatch['song']> = {};
    for (const field of songFields) {
      if (Object.prototype.hasOwnProperty.call(patch.song, field)) song[field] = current.song[field];
    }
    base.song = song;
  }
  return { patch, base };
}

export function mergeMomentPatchEnvelopes(
  current: MomentPatchEnvelope,
  next: MomentPatchEnvelope,
): MomentPatchEnvelope {
  return {
    patch: {
      ...current.patch,
      ...next.patch,
      song: current.patch.song || next.patch.song
        ? { ...current.patch.song, ...next.patch.song }
        : undefined,
    },
    base: {
      ...next.base,
      ...current.base,
      song: current.base.song || next.base.song
        ? { ...next.base.song, ...current.base.song }
        : undefined,
    },
  };
}

export function applyMomentPatch(moment: JourneyMoment, patch: MomentPatch): JourneyMoment {
  const { song, ...momentPatch } = patch;
  return {
    ...moment,
    ...momentPatch,
    song: song ? { ...moment.song, ...song } : moment.song,
  };
}

export function momentPatchConflicts(remote: JourneyMoment, envelope: MomentPatchEnvelope): string[] {
  const conflicts: string[] = [];
  for (const field of momentFields) {
    if (
      Object.prototype.hasOwnProperty.call(envelope.patch, field)
      && remote[field] !== envelope.base[field]
    ) conflicts.push(field);
  }
  for (const field of songFields) {
    if (
      Object.prototype.hasOwnProperty.call(envelope.patch.song ?? {}, field)
      && remote.song[field] !== envelope.base.song?.[field]
    ) conflicts.push(`song.${field}`);
  }
  return conflicts;
}

export function momentPatchMatches(remote: JourneyMoment, patch: MomentPatch): boolean {
  for (const field of momentFields) {
    if (Object.prototype.hasOwnProperty.call(patch, field) && remote[field] !== patch[field]) return false;
  }
  for (const field of songFields) {
    if (Object.prototype.hasOwnProperty.call(patch.song ?? {}, field) && remote.song[field] !== patch.song?.[field]) {
      return false;
    }
  }
  return true;
}
