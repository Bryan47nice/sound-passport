import type {
  MomentAutosaveOutboxPort,
  MomentAutosaveOutboxRecord,
} from '../../data/ports';
import type { JourneyOutboxOwnerClaimer } from './journeyOutbox';

export interface MomentOutboxRecoveryCandidate {
  ownerId: string;
  generation: string;
  updatedAt: string;
}

export type MomentOutboxRecoveryResult =
  | { kind: 'none' }
  | { kind: 'recovered'; record: MomentAutosaveOutboxRecord }
  | { kind: 'candidates'; candidates: MomentOutboxRecoveryCandidate[] };

async function claimRecoveryOwner(
  claimOwner: JourneyOutboxOwnerClaimer | undefined,
  ownerId: string,
) {
  try {
    return await claimOwner?.(ownerId);
  } catch {
    return undefined;
  }
}

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

async function discoverMomentOutbox(
  outbox: MomentAutosaveOutboxPort,
  momentId: string,
  journeyId: string,
  ownerId: string,
): Promise<MomentOutboxRecoveryResult> {
  const exact = normalizeMomentOutboxRecord(
    await outbox.getMomentOutbox(momentId, ownerId),
    momentId,
    journeyId,
    ownerId,
  );
  if (exact) return { kind: 'recovered', record: exact };

  const candidates = (await outbox.listMomentOutboxesByJourney(journeyId))
    .map((record) => normalizeMomentOutboxRecord(record, momentId, journeyId))
    .filter((record): record is MomentAutosaveOutboxRecord => (
      record !== undefined && record.ownerId !== ownerId
    ))
    .sort((left, right) => (
      Date.parse(right.updatedAt) - Date.parse(left.updatedAt) ||
      left.ownerId.localeCompare(right.ownerId) ||
      left.generation.localeCompare(right.generation)
    ));
  if (candidates.length === 0) return { kind: 'none' };

  return {
    kind: 'candidates',
    candidates: candidates.map(({ ownerId: candidateOwnerId, generation, updatedAt }) => ({
      ownerId: candidateOwnerId,
      generation,
      updatedAt,
    })),
  };
}

export async function readMomentOutbox(
  outbox: MomentAutosaveOutboxPort,
  momentId: string,
  journeyId: string,
  ownerId: string,
  claimOwner?: JourneyOutboxOwnerClaimer,
): Promise<MomentOutboxRecoveryResult> {
  const discovered = await discoverMomentOutbox(outbox, momentId, journeyId, ownerId);
  if (discovered.kind !== 'candidates' || discovered.candidates.length !== 1) return discovered;

  const [candidate] = discovered.candidates;
  const claim = await claimRecoveryOwner(claimOwner, candidate.ownerId);
  if (!claim) return discovered;
  try {
    const adopted = normalizeMomentOutboxRecord(
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
    if (adopted) return { kind: 'recovered', record: adopted };

    const refreshed = await discoverMomentOutbox(outbox, momentId, journeyId, ownerId);
    if (
      refreshed.kind !== 'candidates' ||
      refreshed.candidates.length !== 1 ||
      refreshed.candidates[0].ownerId !== candidate.ownerId
    ) return refreshed;

    const [newer] = refreshed.candidates;
    const retried = normalizeMomentOutboxRecord(
      await outbox.adoptMomentOutbox(
        momentId,
        journeyId,
        newer.ownerId,
        ownerId,
        newer.generation,
      ),
      momentId,
      journeyId,
      ownerId,
    );
    return retried ? { kind: 'recovered', record: retried } : refreshed;
  } finally {
    await claim.release();
  }
}

export async function adoptMomentOutboxCandidate(
  outbox: MomentAutosaveOutboxPort,
  momentId: string,
  journeyId: string,
  ownerId: string,
  candidate: MomentOutboxRecoveryCandidate,
  claimOwner?: JourneyOutboxOwnerClaimer,
): Promise<MomentOutboxRecoveryResult> {
  const claim = await claimRecoveryOwner(claimOwner, candidate.ownerId);
  try {
    const adopted = normalizeMomentOutboxRecord(
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
    return adopted
      ? { kind: 'recovered', record: adopted }
      : await discoverMomentOutbox(outbox, momentId, journeyId, ownerId);
  } finally {
    await claim?.release();
  }
}
