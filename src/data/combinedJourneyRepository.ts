import { summarizeCountries } from '../domain/countrySummary';
import type { Journey } from '../domain/model';
import type { JourneyRepository } from './ports';

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
    const summaries = (await Promise.all(repositories.map((repository) => repository.listCountrySummaries()))).flat();
    const countryCodes = [...new Set(summaries.map((summary) => summary.countryCode))];
    const journeys = (
      await Promise.all(
        countryCodes.flatMap((countryCode) => repositories.map((repository) => repository.listJourneysByCountry(countryCode))),
      )
    ).flat();
    assertUniqueJourneyIds(journeys);
    return journeys;
  }

  return {
    async listCountrySummaries() {
      return summarizeCountries(await listAllJourneys());
    },

    async listJourneysByCountry(countryCode) {
      const journeys = (await Promise.all(
        repositories.map((repository) => repository.listJourneysByCountry(countryCode)),
      )).flat();
      assertUniqueJourneyIds(journeys);
      return sortJourneys(journeys);
    },

    async getJourneyStory(journeyId) {
      const stories = (await Promise.all(
        repositories.map((repository) => repository.getJourneyStory(journeyId)),
      )).filter((story) => story !== undefined);
      if (stories.length > 1) throw new Error(`Duplicate journey ID: ${journeyId}`);
      return stories[0];
    },
  };
}
