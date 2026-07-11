export interface SongReference {
  id: string;
  provider: 'youtube' | 'external' | 'manual';
  providerItemId?: string;
  sourceUrl?: string;
  title: string;
  artist: string;
  availability: 'available' | 'unavailable' | 'unknown';
}

export interface Journey {
  id: string;
  title: string;
  countryCode: string;
  countryName: string;
  countryCoordinates: [number, number];
  cityLabels: string[];
  startDate: string;
  endDate: string;
  status: 'active' | 'review' | 'complete';
}

export interface Moment {
  id: string;
  journeyId: string;
  songReferenceId: string;
  takenAt: string;
  timeZone: string;
  photoUrl: string;
  photoAlt: string;
  placeLabel: string;
  cityLabel: string;
  reason: string;
  reasonStatus: 'complete' | 'needs_review';
  sortOrder: number;
}

export interface JourneyMoment extends Moment {
  song: SongReference;
}

export interface JourneyStory {
  journey: Journey;
  moments: JourneyMoment[];
}

export interface CountrySummary {
  countryCode: string;
  countryName: string;
  coordinates: [number, number];
  journeyCount: number;
  latestJourneyTitle: string;
}
