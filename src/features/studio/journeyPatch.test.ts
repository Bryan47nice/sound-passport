import { describe, expect, it } from 'vitest';
import type { Journey } from '../../domain/model';
import {
  createJourneyPatchEnvelope,
  journeyPatchBaseMatches,
  journeyPatchMatchesPersisted,
  mergeJourneyPatchEnvelopes,
  type JourneyUserPatch,
} from './journeyPatch';

const journey: Journey = {
  id: 'journey-1',
  title: '原始標題',
  countryCode: 'JP',
  countryName: '日本',
  countryCoordinates: [139.6917, 35.6895],
  cityLabels: ['東京'],
  startDate: '2024-05-01',
  endDate: '2024-05-03',
  summary: '原始總文',
  status: 'complete',
  source: 'private',
  createdAt: '2024-05-01T00:00:00.000Z',
  updatedAt: '2024-05-04T00:00:00.000Z',
};

describe('journey patch envelopes', () => {
  it('allows only user-editable fields and captures their values before the edit', () => {
    const unsafePatch = {
      title: '新的標題',
      status: 'draft',
      id: 'replacement-id',
      source: 'fixture',
      updatedAt: '2099-01-01T00:00:00.000Z',
    } as unknown as JourneyUserPatch;

    expect(createJourneyPatchEnvelope(journey, unsafePatch)).toEqual({
      patch: { title: '新的標題' },
      base: { title: '原始標題' },
    });
  });

  it('keeps the earliest base and latest value while coalescing field patches', () => {
    const first = createJourneyPatchEnvelope(journey, { title: '第一版' });
    const second = createJourneyPatchEnvelope(
      { ...journey, title: '第一版' },
      { title: '最終版', summary: '新的總文' },
    );

    expect(mergeJourneyPatchEnvelopes(first, second)).toEqual({
      patch: { title: '最終版', summary: '新的總文' },
      base: { title: '原始標題', summary: '原始總文' },
    });
  });

  it('compares only edited keys and isolates mutable array values', () => {
    const cities = ['東京', '京都'];
    const envelope = createJourneyPatchEnvelope(journey, { cityLabels: cities });
    cities.push('大阪');

    expect(envelope.patch.cityLabels).toEqual(['東京', '京都']);
    expect(journeyPatchBaseMatches(envelope, { ...journey, summary: '其他分頁的新總文' })).toBe(true);
    expect(journeyPatchBaseMatches(envelope, { ...journey, cityLabels: ['札幌'] })).toBe(false);
  });

  it('recognizes an idempotent recovered patch without accepting a different persisted value', () => {
    const envelope = createJourneyPatchEnvelope(journey, {
      title: '已由舊實例儲存',
      cityLabels: ['東京', '京都'],
    });

    expect(journeyPatchMatchesPersisted(envelope, {
      ...journey,
      title: '已由舊實例儲存',
      cityLabels: ['東京', '京都'],
    })).toBe(true);
    expect(journeyPatchMatchesPersisted(envelope, {
      ...journey,
      title: '其他位置的新標題',
      cityLabels: ['東京', '京都'],
    })).toBe(false);
  });
});
