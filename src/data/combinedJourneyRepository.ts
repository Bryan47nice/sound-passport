import { summarizeCountries } from '../domain/countrySummary';
import type { Journey } from '../domain/model';
import type { JourneyRepository } from './ports';
import { JourneyQueryError } from './storageErrors';

function assertUniqueJourneyIds(journeys: Journey[]) {
  const ids = new Set<string>();
  for (const journey of journeys) {
    if (ids.has(journey.id)) throw new Error(`Duplicate journey ID: ${journey.id}`);
    ids.add(journey.id);
  }
}

function sortJourneys(journeys: Journey[]) {
  return [...journeys].sort(
    (left, right) => right.startDate.localeCompare(left.startDate) || left.id.localeCompare(right.id),
  );
}

export function createCombinedJourneyRepository(...repositories: JourneyRepository[]): JourneyRepository {
  async function listAllJourneys() {
    const summaryResults = await Promise.allSettled(
      repositories.map((repository) => repository.listCountrySummaries()),
    );
    const availableRepositories = repositories.filter(
      (_repository, index) => summaryResults[index].status === 'fulfilled',
    );
    const summaries = summaryResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    const countryCodes = [...new Set(summaries.map((summary) => summary.countryCode))];
    const journeyResults = await Promise.allSettled(
      countryCodes.flatMap((countryCode) => availableRepositories.map(
        (repository) => repository.listJourneysByCountry(countryCode),
      )),
    );
    const journeys = journeyResults.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
    assertUniqueJourneyIds(journeys);
    return {
      journeys,
      degraded: summaryResults.some(({ status }) => status === 'rejected')
        || journeyResults.some(({ status }) => status === 'rejected'),
    };
  }

  return {
    async listCountrySummaries() {
      const { journeys, degraded } = await listAllJourneys();
      const summaries = summarizeCountries(journeys);
      if (degraded) throw new JourneyQueryError('Some journey sources could not be read.', summaries);
      return summaries;
    },

    async listJourneysByCountry(countryCode) {
      const results = await Promise.allSettled(
        repositories.map((repository) => repository.listJourneysByCountry(countryCode)),
      );
      const journeys = results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
      assertUniqueJourneyIds(journeys);
      const sorted = sortJourneys(journeys);
      if (results.some(({ status }) => status === 'rejected')) {
        throw new JourneyQueryError('Some journey sources could not be read.', sorted);
      }
      return sorted;
    },

    async getJourneyStory(journeyId) {
      const results = await Promise.allSettled(
        repositories.map((repository) => repository.getJourneyStory(journeyId)),
      );
      const stories = results.flatMap((result) => (
        result.status === 'fulfilled' && result.value !== undefined ? [result.value] : []
      ));
      if (stories.length > 1) throw new Error(`Duplicate journey ID: ${journeyId}`);
      if (stories.length === 0 && results.some(({ status }) => status === 'rejected')) {
        throw new JourneyQueryError('Journey data could not be read.');
      }
      return stories[0];
    },
  };
}
