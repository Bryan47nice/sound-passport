import type {
  MomentAutosaveOutboxPort,
  MomentAutosaveOutboxRecord,
} from '../../data/ports';
import {
  tryClaimJourneyOutboxOwner,
  type JourneyOutboxOwnerClaimer,
} from './journeyOutbox';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeMomentOutboxRecord(
  value: unknown,
  momentId: string,
  journeyId: string,
  ownerId?: string,
): MomentAutosaveOutboxRecord | undefined {
  if (!isRecord(value) || !isRecord(value.envelope)) return undefined;
  const envelope = value.envelope;
  if (
    value.momentId !== momentId ||
    value.journeyId !== journeyId ||
    typeof value.ownerId !== 'string' || value.ownerId.length === 0 ||
    (ownerId !== undefined && value.ownerId !== ownerId) ||
    typeof value.generation !== 'string' || value.generation.length === 0 ||
    typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt)) ||
    !isRecord(envelope.patch) || !isRecord(envelope.base)
  ) return undefined;
  return value as unknown as MomentAutosaveOutboxRecord;
}

export async function readMomentOutbox(
  outbox: MomentAutosaveOutboxPort,
  momentId: string,
  journeyId: string,
  ownerId: string,
  claimOwner: JourneyOutboxOwnerClaimer = tryClaimJourneyOutboxOwner,
): Promise<MomentAutosaveOutboxRecord | undefined> {
  const exact = normalizeMomentOutboxRecord(
    await outbox.getMomentOutbox(momentId, ownerId),
    momentId,
    journeyId,
    ownerId,
  );
  if (exact) return exact;

  const candidates = (await outbox.listMomentOutboxesByJourney(journeyId))
    .map((record) => normalizeMomentOutboxRecord(record, momentId, journeyId))
    .filter((record): record is MomentAutosaveOutboxRecord => (
      record !== undefined && record.ownerId !== ownerId
    ));
  if (candidates.length !== 1) return undefined;

  const [candidate] = candidates;
  const claim = await claimOwner(candidate.ownerId);
  if (!claim) return undefined;
  try {
    return normalizeMomentOutboxRecord(
      await outbox.adoptMomentOutbox(
        momentId,
        journeyId,
        candidate.ownerId,
        ownerId,
        candidate.generation,
      ),
      momentId,
      journeyId,
      ownerId,
    );
  } finally {
    await claim.release();
  }
}
