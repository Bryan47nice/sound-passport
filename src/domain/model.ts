export type JourneyStatus = 'draft' | 'review' | 'complete';
export type SongAvailability = 'available' | 'invalid_link' | 'needs_link';

export interface Journey {
  id: string;
  title: string;
  countryCode: string;
  countryName: string;
  countryCoordinates: [number, number];
  cityLabels: string[];
  startDate: string;
  endDate: string;
  summary: string;
  coverPhotoAssetId?: string;
  status: JourneyStatus;
  createdAt: string;
  updatedAt: string;
  source: 'fixture' | 'private';
}

export interface SongReference {
  id: string;
  provider: 'youtube' | 'manual';
  providerItemId?: string;
  sourceUrl?: string;
  title: string;
  artist: string;
  availability: SongAvailability;
}

export interface Moment {
  id: string;
  journeyId: string;
  photoAssetId?: string;
  photoUrl?: string;
  photoAlt: string;
  songReferenceId: string;
  localDate: string;
  localTime?: string;
  cityLabel: string;
  placeLabel: string;
  caption: string;
  reason: string;
  reasonStatus: 'complete' | 'needs_review';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** @deprecated Kept only while the existing journey/player views migrate to local fields. */
  takenAt?: string;
  /** @deprecated Kept only while the existing journey/player views migrate to local fields. */
  timeZone?: string;
}

export interface PhotoAsset {
  id: string;
  blob: Blob;
  contentType: string;
  originalFileName: string;
  width: number;
  height: number;
  byteSize: number;
  createdAt: string;
}

export type NewJourney = Pick<Journey,
  'title' | 'countryCode' | 'countryName' | 'countryCoordinates' |
  'cityLabels' | 'startDate' | 'endDate' | 'summary'
>;

export type JourneyPatch = Partial<Pick<Journey,
  'title' | 'countryCode' | 'countryName' | 'countryCoordinates' |
  'cityLabels' | 'startDate' | 'endDate' | 'summary' |
  'coverPhotoAssetId' | 'status'
>>;

export type MomentPatch = Partial<Pick<Moment,
  'localDate' | 'localTime' | 'cityLabel' | 'placeLabel' | 'caption' |
  'reason' | 'reasonStatus' | 'photoAlt'
>> & {
  song?: Pick<SongReference, 'title' | 'artist' | 'sourceUrl'>;
};

export type NormalizedPhotoInput = Pick<PhotoAsset,
  'blob' | 'contentType' | 'originalFileName' | 'width' | 'height' | 'byteSize'
>;

export interface PrivateJourneySnapshot {
  journeys: Journey[];
  moments: Moment[];
  songs: SongReference[];
  photos: PhotoAsset[];
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
