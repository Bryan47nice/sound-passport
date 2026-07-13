import { afterEach, describe, expect, it } from 'vitest';
import type { JourneyPatchEnvelope } from './journeyPatch';
import {
  clearJourneyOutbox,
  readJourneyOutbox,
  writeJourneyOutbox,
} from './journeyOutbox';

const firstEnvelope: JourneyPatchEnvelope = {
  patch: { title: '離線標題', cityLabels: ['東京', '橫濱'] },
  base: { title: '東京夜行', cityLabels: ['東京'] },
};

describe('journeyOutbox', () => {
  afterEach(() => sessionStorage.clear());

  it('keeps only the latest field-patch envelope for each journey in tab-local storage', () => {
    const latestEnvelope: JourneyPatchEnvelope = {
      patch: { title: '最後標題' },
      base: { title: '東京夜行' },
    };

    writeJourneyOutbox('private-tokyo', firstEnvelope);
    writeJourneyOutbox('private-tokyo', latestEnvelope);
    writeJourneyOutbox('private-kyoto', firstEnvelope);

    expect(readJourneyOutbox('private-tokyo')).toEqual(latestEnvelope);
    expect(readJourneyOutbox('private-kyoto')).toEqual(firstEnvelope);
    expect(sessionStorage).toHaveLength(2);
  });

  it('serializes only supported field patches and excludes unrelated photo or fixture data', () => {
    const contaminated = {
      ...firstEnvelope,
      photo: new Blob(['private photo']),
      fixtureJourney: { id: 'fixture-tokyo' },
      patch: { ...firstEnvelope.patch, source: 'fixture' },
    } as unknown as JourneyPatchEnvelope;

    writeJourneyOutbox('private-tokyo', contaminated);

    expect(readJourneyOutbox('private-tokyo')).toEqual(firstEnvelope);
    const serialized = sessionStorage.getItem(sessionStorage.key(0)!);
    expect(serialized).not.toContain('private photo');
    expect(serialized).not.toContain('fixture');
    expect(serialized).not.toContain('source');
  });

  it('ignores malformed storage and clears an envelope only when asked', () => {
    writeJourneyOutbox('private-tokyo', firstEnvelope);
    const key = sessionStorage.key(0)!;
    sessionStorage.setItem(key, '{broken');

    expect(readJourneyOutbox('private-tokyo')).toBeUndefined();
    expect(sessionStorage.getItem(key)).toBe('{broken');

    clearJourneyOutbox('private-tokyo');
    expect(sessionStorage.getItem(key)).toBeNull();
  });
});
