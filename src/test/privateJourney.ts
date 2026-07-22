import { Blob as NodeBlob } from 'node:buffer';
import type { JourneyEditorRepository } from '../data/ports';
import type { NewJourney, NormalizedPhotoInput } from '../domain/model';

export const publishedJourneyInput: NewJourney = {
  title: '花蓮海岸公路',
  countryCode: 'TW',
  countryName: '臺灣',
  countryCoordinates: [121.5654, 25.033],
  cityLabels: ['花蓮'],
  startDate: '2026-04-01',
  endDate: '2026-04-03',
  summary: '沿著海岸，把兩段風景留在同一趟旅程。',
};

function photoInput(fileName: string): NormalizedPhotoInput {
  const blob = new NodeBlob([fileName], { type: 'image/jpeg' }) as unknown as Blob;
  return {
    blob,
    contentType: blob.type,
    originalFileName: fileName,
    width: 1200,
    height: 800,
    byteSize: blob.size,
  };
}

export async function seedPrivateReviewJourney(repository: JourneyEditorRepository) {
  const journey = await repository.createJourney(publishedJourneyInput);
  const [first, second] = await repository.addMoments(journey.id, [
    photoInput('coast-one.jpg'),
    photoInput('coast-two.jpg'),
  ]);

  await repository.updateMoment(first.id, {
    caption: '第一段圖說',
    cityLabel: '花蓮',
    placeLabel: '七星潭',
    song: { title: '起點之歌', artist: '測試歌手', sourceUrl: '' },
  }, { expectedUpdatedAt: first.updatedAt });
  await repository.updateMoment(second.id, {
    caption: '第二段圖說',
    cityLabel: '花蓮',
    placeLabel: '石梯坪',
    song: { title: '終點之歌', artist: '測試歌手', sourceUrl: '' },
  }, { expectedUpdatedAt: second.updatedAt });
  await repository.reorderMoments(journey.id, [second.id, first.id]);

  const readyStory = await repository.getPrivateJourneyStory(journey.id);
  if (!readyStory) throw new Error('Expected the seeded private journey story.');
  await repository.setJourneyStatus(journey.id, 'review', {
    expectedUpdatedAt: readyStory.journey.updatedAt,
  });

  const reviewStory = await repository.getPrivateJourneyStory(journey.id);
  if (!reviewStory) throw new Error('Expected the seeded review journey story.');
  return reviewStory;
}
