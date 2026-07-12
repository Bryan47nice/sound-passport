import { summarizeCountries } from '../domain/countrySummary';
import { fixtureJourneys, fixtureMoments, fixtureSongs } from '../domain/fixtures';
import type { JourneyRepository } from './ports';

export const fixtureJourneyRepository: JourneyRepository = {
  async listCountrySummaries() {
    return summarizeCountries(fixtureJourneys);
  },
  async listJourneysByCountry(countryCode) {
    return fixtureJourneys
      .filter((item) => item.countryCode === countryCode)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  },
  async getJourneyStory(journeyId) {
    const journey = fixtureJourneys.find((item) => item.id === journeyId);
    if (!journey) return undefined;
    const moments = fixtureMoments
      .filter((item) => item.journeyId === journeyId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((moment) => ({ ...moment, song: fixtureSongs.find((song) => song.id === moment.songReferenceId)! }));
    return { journey, moments };
  },
};
