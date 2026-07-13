import { describe, expect, it } from 'vitest';
import { summarizeCountries } from '../domain/countrySummary';
import type { Journey, JourneyStory } from '../domain/model';
import type { JourneyRepository } from './ports';
import { createCombinedJourneyRepository } from './combinedJourneyRepository';

function journey(overrides: Partial<Journey>): Journey {
  return {
    id: 'journey',
    title: 'Journey',
    countryCode: 'JP',
    countryName: 'Japan',
    countryCoordinates: [139.6917, 35.6895],
    cityLabels: ['Tokyo'],
    startDate: '2024-01-01',
    endDate: '2024-01-02',
    summary: '',
    status: 'complete',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    source: 'fixture',
    ...overrides,
  };
}

function repository(journeys: Journey[], stories: JourneyStory[]): JourneyRepository {
  return {
    async listCountrySummaries() {
      return summarizeCountries(journeys);
    },
    async listJourneysByCountry(countryCode) {
      return journeys.filter((item) => item.countryCode === countryCode);
    },
    async getJourneyStory(journeyId) {
      return stories.find((story) => story.journey.id === journeyId);
    },
  };
}

describe('createCombinedJourneyRepository', () => {
  it('merges journeys and stories while recomputing country summaries', async () => {
    const privateJourney = journey({
      id: 'private-newer',
      title: 'Private journey',
      startDate: '2025-04-01',
      source: 'private',
    });
    const fixtureJourney = journey({ id: 'fixture-older', title: 'Fixture journey' });
    const privateStory: JourneyStory = { journey: privateJourney, moments: [] };
    const fixtureStory: JourneyStory = { journey: fixtureJourney, moments: [] };
    const combined = createCombinedJourneyRepository(
      repository([fixtureJourney], [fixtureStory]),
      repository([privateJourney], [privateStory]),
    );

    expect(await combined.listJourneysByCountry('JP')).toEqual([
      expect.objectContaining({ id: 'private-newer', source: 'private' }),
      expect.objectContaining({ id: 'fixture-older', source: 'fixture' }),
    ]);
    expect(await combined.getJourneyStory('private-newer')).toEqual(privateStory);
    expect(await combined.getJourneyStory('fixture-older')).toEqual(fixtureStory);
    expect(await combined.listCountrySummaries()).toContainEqual(expect.objectContaining({
      countryCode: 'JP',
      journeyCount: 2,
      latestJourneyTitle: privateStory.journey.title,
    }));
  });

  it('rejects duplicate journey IDs rather than shadowing a source', async () => {
    const duplicate = journey({ id: 'duplicate' });
    const combined = createCombinedJourneyRepository(
      repository([duplicate], [{ journey: duplicate, moments: [] }]),
      repository([{ ...duplicate, source: 'private' }], [{ journey: duplicate, moments: [] }]),
    );

    await expect(combined.listCountrySummaries()).rejects.toThrow('Duplicate journey ID: duplicate');
  });
});
