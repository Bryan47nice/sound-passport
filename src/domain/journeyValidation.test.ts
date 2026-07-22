import { describe, expect, it } from 'vitest';
import type { JourneyStory } from './model';
import { validateJourneyForReview } from './journeyValidation';

const validStory: JourneyStory = {
  journey: {
    id: 'journey-1',
    title: '東京，雨停之後',
    countryCode: 'JP',
    countryName: '日本',
    countryCoordinates: [139.6917, 35.6895],
    cityLabels: ['東京'],
    startDate: '2024-10-03',
    endDate: '2024-10-08',
    summary: '一段以音樂記錄的城市散步。',
    status: 'review',
    createdAt: '2024-10-08T12:00:00Z',
    updatedAt: '2024-10-08T12:00:00Z',
    source: 'private',
  },
  moments: [{
    id: 'moment-1',
    journeyId: 'journey-1',
    photoUrl: 'https://example.com/tokyo.jpg',
    photoAlt: '雨夜裡的澀谷十字路口',
    songReferenceId: 'song-1',
    localDate: '2024-10-03',
    localTime: '21:42',
    cityLabel: '東京',
    placeLabel: '澀谷十字路口',
    caption: '雨停後的路面仍在反光。',
    reason: '這首歌讓夜晚慢了下來。',
    reasonStatus: 'complete',
    sortOrder: 0,
    createdAt: '2024-10-03T12:42:00Z',
    updatedAt: '2024-10-03T12:42:00Z',
    song: {
      id: 'song-1',
      provider: 'youtube',
      title: 'Tokyo, after the rain',
      artist: 'Sound Passport Demo',
      availability: 'available',
    },
  }],
};

describe('validateJourneyForReview', () => {
  it('accepts a complete journey and keeps optional YouTube metadata non-blocking', () => {
    const storyWithoutYoutube: JourneyStory = {
      ...validStory,
      moments: [{
        ...validStory.moments[0],
        song: { ...validStory.moments[0].song, provider: 'manual', sourceUrl: undefined },
      }],
    };

    expect(validateJourneyForReview(validStory)).toEqual({ valid: true, issues: [] });
    expect(validateJourneyForReview(storyWithoutYoutube)).toEqual({ valid: true, issues: [] });
  });

  it('reports the required journey title', () => {
    expect(validateJourneyForReview({ ...validStory, journey: { ...validStory.journey, title: '' } }).issues)
      .toContainEqual({ field: 'title', code: 'required' });
  });

  it('requires at least one moment', () => {
    expect(validateJourneyForReview({ ...validStory, moments: [] }).issues)
      .toContainEqual({ field: 'moments', code: 'at_least_one' });
  });

  it('rejects a moment outside the journey date range', () => {
    const storyWithMomentOutsideRange: JourneyStory = {
      ...validStory,
      moments: [{ ...validStory.moments[0], localDate: '2024-10-09' }],
    };

    expect(validateJourneyForReview(storyWithMomentOutsideRange).issues)
      .toContainEqual({ field: 'moments.0.localDate', code: 'outside_journey_range' });
  });
});
