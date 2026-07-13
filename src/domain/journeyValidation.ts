import type { JourneyStory } from './model';

export type JourneyValidationCode = 'required' | 'at_least_one' | 'invalid_range' | 'outside_journey_range';

export interface JourneyValidationIssue {
  field: string;
  code: JourneyValidationCode;
}

export interface JourneyValidationResult {
  valid: boolean;
  issues: JourneyValidationIssue[];
}

const isBlank = (value: string | undefined) => !value?.trim();

export function validateJourneyForReview(story: JourneyStory): JourneyValidationResult {
  const { journey, moments } = story;
  const issues: JourneyValidationIssue[] = [];

  if (isBlank(journey.title)) issues.push({ field: 'title', code: 'required' });
  if (isBlank(journey.countryCode)) issues.push({ field: 'countryCode', code: 'required' });
  if (isBlank(journey.startDate)) issues.push({ field: 'startDate', code: 'required' });
  if (isBlank(journey.endDate)) issues.push({ field: 'endDate', code: 'required' });
  if (journey.startDate && journey.endDate && journey.startDate > journey.endDate) {
    issues.push({ field: 'endDate', code: 'invalid_range' });
  }

  if (moments.length === 0) issues.push({ field: 'moments', code: 'at_least_one' });

  moments.forEach((moment, index) => {
    const prefix = `moments.${index}`;
    if (!moment.photoAssetId && isBlank(moment.photoUrl)) issues.push({ field: `${prefix}.photo`, code: 'required' });
    if (isBlank(moment.localDate)) issues.push({ field: `${prefix}.localDate`, code: 'required' });
    if (isBlank(moment.song.title)) issues.push({ field: `${prefix}.song.title`, code: 'required' });
    if (isBlank(moment.song.artist)) issues.push({ field: `${prefix}.song.artist`, code: 'required' });
    if (moment.localDate && journey.startDate && journey.endDate && (
      moment.localDate < journey.startDate || moment.localDate > journey.endDate
    )) {
      issues.push({ field: `${prefix}.localDate`, code: 'outside_journey_range' });
    }
  });

  return { valid: issues.length === 0, issues };
}
