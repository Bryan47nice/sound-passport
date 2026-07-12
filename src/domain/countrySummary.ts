import type { CountrySummary, Journey } from './model';

export function summarizeCountries(journeys: Journey[]): CountrySummary[] {
  const groups = new Map<string, Journey[]>();
  journeys.forEach((journey) => {
    groups.set(journey.countryCode, [...(groups.get(journey.countryCode) ?? []), journey]);
  });

  return [...groups.values()]
    .map((items) => {
      const sorted = [...items].sort((a, b) => b.startDate.localeCompare(a.startDate));
      const latest = sorted[0];
      return {
        countryCode: latest.countryCode,
        countryName: latest.countryName,
        coordinates: latest.countryCoordinates,
        journeyCount: items.length,
        latestJourneyTitle: latest.title,
      };
    })
    .sort((a, b) => a.countryName.localeCompare(b.countryName, 'zh-TW'));
}
