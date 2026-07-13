import { describe, expect, it } from 'vitest';
import { fixtureJourneyRepository } from './fixtureJourneyRepository';

describe('fixtureJourneyRepository', () => {
  it('groups repeat visits and returns newest journey first', async () => {
    const countries = await fixtureJourneyRepository.listCountrySummaries();
    expect(countries.find((item) => item.countryCode === 'JP')?.journeyCount).toBe(2);
    expect((await fixtureJourneyRepository.listJourneysByCountry('JP')).map((item) => item.id)).toEqual([
      'tokyo-2024',
      'kyoto-2023',
    ]);
  });

  it('returns moments in curated order', async () => {
    const story = await fixtureJourneyRepository.getJourneyStory('tokyo-2024');
    expect(story?.moments.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
    expect(story?.moments[0]).toMatchObject({
      photoAlt: '雨夜裡的澀谷十字路口',
      localDate: '2024-10-03',
      localTime: '21:42',
    });
  });
});
