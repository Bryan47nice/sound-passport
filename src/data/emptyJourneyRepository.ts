import type { JourneyRepository } from './ports';

export const emptyJourneyRepository: JourneyRepository = {
  listCountrySummaries: async () => [],
  listJourneysByCountry: async () => [],
  getJourneyStory: async () => undefined,
};
