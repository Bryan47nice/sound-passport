import type { CountrySummary, Journey, JourneyStory } from '../domain/model';

export interface JourneyRepository {
  listCountrySummaries(): Promise<CountrySummary[]>;
  listJourneysByCountry(countryCode: string): Promise<Journey[]>;
  getJourneyStory(journeyId: string): Promise<JourneyStory | undefined>;
}
