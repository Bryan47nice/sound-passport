import { describe, expect, it } from 'vitest';
import type { Journey } from '../../domain/model';
import { filterJourneysByStudioStatus } from './studioFilters';

const journeys: Journey[] = [
  {
    id: 'draft', title: '草稿旅程', countryCode: 'JP', countryName: '日本', countryCoordinates: [139, 35],
    cityLabels: [], startDate: '2024-01-01', endDate: '2024-01-02', summary: '', status: 'draft',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'private',
  },
  {
    id: 'review', title: '待整理旅程', countryCode: 'KR', countryName: '韓國', countryCoordinates: [126, 37],
    cityLabels: [], startDate: '2024-01-01', endDate: '2024-01-02', summary: '', status: 'review',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'private',
  },
  {
    id: 'complete', title: '已完成旅程', countryCode: 'TW', countryName: '臺灣', countryCoordinates: [121, 23],
    cityLabels: [], startDate: '2024-01-01', endDate: '2024-01-02', summary: '', status: 'complete',
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z', source: 'private',
  },
];

describe('filterJourneysByStudioStatus', () => {
  it.each([
    ['draft', ['draft']],
    ['review', ['review']],
    ['complete', ['complete']],
  ] as const)('returns only %s journeys', (status, ids) => {
    expect(filterJourneysByStudioStatus(journeys, status).map((journey) => journey.id)).toEqual(ids);
  });
});
