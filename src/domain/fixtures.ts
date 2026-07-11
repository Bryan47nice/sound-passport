import type { Journey, Moment, SongReference } from './model';

export const fixtureJourneys: Journey[] = [
  { id: 'tokyo-2024', title: '東京，雨停之後', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895], cityLabels: ['東京'], startDate: '2024-10-03', endDate: '2024-10-08', status: 'complete' },
  { id: 'kyoto-2023', title: '京都，安靜的顏色', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895], cityLabels: ['京都'], startDate: '2023-04-10', endDate: '2023-04-15', status: 'complete' },
  { id: 'seoul-2025', title: '首爾，十月的夜', countryCode: 'KR', countryName: '韓國', countryCoordinates: [126.978, 37.5665], cityLabels: ['首爾'], startDate: '2025-10-12', endDate: '2025-10-17', status: 'complete' },
];

export const fixtureSongs: SongReference[] = [
  { id: 'song-tokyo-1', provider: 'youtube', providerItemId: 'M7lc1UVf-VE', sourceUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', title: 'Tokyo, after the rain', artist: 'Sound Passport Demo', availability: 'available' },
  { id: 'song-tokyo-2', provider: 'manual', title: 'Shibuya Night Walk', artist: 'Sound Passport Demo', availability: 'unknown' },
  { id: 'song-tokyo-3', provider: 'manual', title: 'Last Train Home', artist: 'Sound Passport Demo', availability: 'unknown' },
  { id: 'song-kyoto-1', provider: 'manual', title: 'Quiet Colors', artist: 'Sound Passport Demo', availability: 'unknown' },
  { id: 'song-seoul-1', provider: 'manual', title: 'Han River Night', artist: 'Sound Passport Demo', availability: 'unknown' },
];

export const fixtureMoments: Moment[] = [
  { id: 'tokyo-m1', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-1', takenAt: '2024-10-03T21:42:00+09:00', timeZone: 'Asia/Tokyo', photoUrl: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=1600&q=82', photoAlt: '雨夜裡的澀谷十字路口', placeLabel: '澀谷十字路口', cityLabel: '東京', reason: '雨停後路面還在反光，整座城市像慢了下來。', reasonStatus: 'complete', sortOrder: 0 },
  { id: 'tokyo-m2', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-2', takenAt: '2024-10-04T22:10:00+09:00', timeZone: 'Asia/Tokyo', photoUrl: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1600&q=82', photoAlt: '東京夜晚的公園步道', placeLabel: '代代木公園', cityLabel: '東京', reason: '夜裡走得很慢，剛好需要一首不趕時間的歌。', reasonStatus: 'complete', sortOrder: 1 },
  { id: 'tokyo-m3', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-3', takenAt: '2024-10-08T18:20:00+09:00', timeZone: 'Asia/Tokyo', photoUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1600&q=82', photoAlt: '夕陽下準備起飛的客機', placeLabel: '羽田機場', cityLabel: '東京', reason: '', reasonStatus: 'needs_review', sortOrder: 2 },
  { id: 'kyoto-m1', journeyId: 'kyoto-2023', songReferenceId: 'song-kyoto-1', takenAt: '2023-04-11T07:30:00+09:00', timeZone: 'Asia/Tokyo', photoUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1600&q=82', photoAlt: '京都清晨的安靜街景', placeLabel: '鴨川', cityLabel: '京都', reason: '早晨的顏色很淡，適合留白。', reasonStatus: 'complete', sortOrder: 0 },
  { id: 'seoul-m1', journeyId: 'seoul-2025', songReferenceId: 'song-seoul-1', takenAt: '2025-10-14T20:00:00+09:00', timeZone: 'Asia/Seoul', photoUrl: 'https://images.unsplash.com/photo-1637070875173-1ecab5fff748?auto=format&fit=crop&w=1600&q=82', photoAlt: '首爾漢江旁的城市夜景', placeLabel: '漢江公園', cityLabel: '首爾', reason: '風吹過河面時，城市的聲音退到了後面。', reasonStatus: 'complete', sortOrder: 0 },
];
