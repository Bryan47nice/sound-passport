import type {
  CountrySummary,
  Journey,
  JourneyPatch,
  JourneyStatus,
  JourneyStory,
  Moment,
  MomentPatch,
  NewJourney,
  NormalizedPhotoInput,
  PhotoAsset,
  PrivateJourneySnapshot,
} from '../domain/model';

export interface JourneyRepository {
  listCountrySummaries(): Promise<CountrySummary[]>;
  listJourneysByCountry(countryCode: string): Promise<Journey[]>;
  getJourneyStory(journeyId: string): Promise<JourneyStory | undefined>;
}

export interface UpdateJourneyOptions {
  expectedUpdatedAt?: string;
}

export class JourneyVersionConflictError extends Error {
  constructor(
    readonly journeyId: string,
    readonly expectedUpdatedAt: string,
    readonly actualUpdatedAt: string,
  ) {
    super(`Journey ${journeyId} changed after version ${expectedUpdatedAt}.`);
    this.name = 'JourneyVersionConflictError';
  }
}

export interface JourneyEditorRepository {
  listPrivateJourneys(): Promise<Journey[]>;
  createJourney(input: NewJourney): Promise<Journey>;
  updateJourney(id: string, patch: JourneyPatch, options?: UpdateJourneyOptions): Promise<Journey>;
  deleteJourney(id: string): Promise<void>;
  getPrivateJourneyStory(id: string): Promise<JourneyStory | undefined>;
  addMoments(journeyId: string, photos: NormalizedPhotoInput[]): Promise<Moment[]>;
  updateMoment(id: string, patch: MomentPatch): Promise<Moment>;
  deleteMoment(id: string): Promise<void>;
  reorderMoments(journeyId: string, orderedIds: string[]): Promise<void>;
  setJourneyStatus(id: string, status: JourneyStatus): Promise<Journey>;
}

export type JourneyAutosaveField =
  | 'title'
  | 'countryCode'
  | 'countryName'
  | 'countryCoordinates'
  | 'cityLabels'
  | 'startDate'
  | 'endDate'
  | 'summary'
  | 'coverPhotoAssetId';

export type JourneyAutosavePatch = Partial<Pick<Journey, JourneyAutosaveField>>;

export interface JourneyAutosaveFieldPatchEnvelope {
  patch: JourneyAutosavePatch;
  base: JourneyAutosavePatch;
}

export interface JourneyAutosaveOutboxRecord {
  journeyId: string;
  ownerId: string;
  generation: string;
  envelope: JourneyAutosaveFieldPatchEnvelope;
  updatedAt: string;
}

export class JourneyAutosaveRecoveryConflictError extends Error {
  constructor(
    readonly journeyId: string,
    readonly ownerIds: readonly string[],
  ) {
    super(`Journey ${journeyId} has multiple independent autosave recovery records.`);
    this.name = 'JourneyAutosaveRecoveryConflictError';
  }
}

export interface JourneyAutosaveOutboxPort {
  get(journeyId: string, ownerId: string): Promise<JourneyAutosaveOutboxRecord | undefined>;
  listByJourney(journeyId: string): Promise<JourneyAutosaveOutboxRecord[]>;
  adopt(
    journeyId: string,
    fromOwnerId: string,
    toOwnerId: string,
    expectedGeneration: string,
  ): Promise<JourneyAutosaveOutboxRecord | undefined>;
  put(record: JourneyAutosaveOutboxRecord): Promise<void>;
  compareAndDelete(journeyId: string, ownerId: string, generation: string): Promise<boolean>;
}

export interface PhotoAssetRepository {
  getPhotoAsset(id: string): Promise<PhotoAsset | undefined>;
}

export interface PrivateDataPrimaryKeys {
  readonly journeys: readonly string[];
  readonly moments: readonly string[];
  readonly songs: readonly string[];
  readonly photos: readonly string[];
}

export class PrivateDataStateConflictError extends Error {
  constructor() {
    super('Private data changed after the import was planned.');
    this.name = 'PrivateDataStateConflictError';
  }
}

export interface PrivateDataPort {
  exportSnapshot(): Promise<PrivateJourneySnapshot>;
  importSnapshot(snapshot: PrivateJourneySnapshot, expectedKeys: PrivateDataPrimaryKeys): Promise<void>;
  clearPrivateData(): Promise<void>;
}
