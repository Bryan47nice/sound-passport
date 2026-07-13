import type { Journey, JourneyStatus } from '../../domain/model';

export function filterJourneysByStudioStatus(journeys: Journey[], status: JourneyStatus): Journey[] {
  return journeys.filter((journey) => journey.status === status);
}
