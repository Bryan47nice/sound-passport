import type { Journey, Moment, SongReference } from './model';

export const fixtureJourneys: Journey[] = [
  { id: 'tokyo-2024', title: '東京，雨停之後', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895], cityLabels: ['東京'], startDate: '2024-10-03', endDate: '2024-10-08', summary: '雨停後的東京，用幾首歌慢慢走完。', status: 'complete', createdAt: '2024-10-08T12:00:00Z', updatedAt: '2024-10-08T12:00:00Z', source: 'fixture' },
  { id: 'kyoto-2023', title: '京都，安靜的顏色', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895], cityLabels: ['京都'], startDate: '2023-04-10', endDate: '2023-04-15', summary: '清晨與傍晚之間，留給京都的聲音。', status: 'complete', createdAt: '2023-04-15T12:00:00Z', updatedAt: '2023-04-15T12:00:00Z', source: 'fixture' },
  { id: 'seoul-2025', title: '首爾，十月的夜', countryCode: 'KR', countryName: '韓國', countryCoordinates: [126.978, 37.5665], cityLabels: ['首爾'], startDate: '2025-10-12', endDate: '2025-10-17', summary: '沿著漢江與街道收集夜裡的節奏。', status: 'complete', createdAt: '2025-10-17T12:00:00Z', updatedAt: '2025-10-17T12:00:00Z', source: 'fixture' },
];

export const fixtureSongs: SongReference[] = [
  { id: 'song-tokyo-1', provider: 'youtube', providerItemId: 'M7lc1UVf-VE', sourceUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE', title: 'Tokyo, after the rain', artist: 'Sound Passport Demo', availability: 'available' },
  { id: 'song-tokyo-2', provider: 'manual', title: 'Shibuya Night Walk', artist: 'Sound Passport Demo', availability: 'needs_link' },
  { id: 'song-tokyo-3', provider: 'manual', title: 'Last Train Home', artist: 'Sound Passport Demo', availability: 'needs_link' },
  { id: 'song-kyoto-1', provider: 'manual', title: 'Quiet Colors', artist: 'Sound Passport Demo', availability: 'needs_link' },
  { id: 'song-seoul-1', provider: 'manual', title: 'Han River Night', artist: 'Sound Passport Demo', availability: 'needs_link' },
];

export const fixtureMoments: Moment[] = [
  { id: 'tokyo-m1', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-1', photoUrl: 'https://images.unsplash.com/photo-1542051841857-5f90071e7989?auto=format&fit=crop&w=1600&q=82', photoAlt: '雨夜裡的澀谷十字路口', localDate: '2024-10-03', localTime: '21:42', cityLabel: '東京', placeLabel: '澀谷十字路口', caption: '雨停後的路面仍在反光。', reason: '雨停後路面還在反光，整座城市像慢了下來。', reasonStatus: 'complete', sortOrder: 0, createdAt: '2024-10-03T12:42:00Z', updatedAt: '2024-10-03T12:42:00Z' },
  { id: 'tokyo-m2', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-2', photoUrl: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?auto=format&fit=crop&w=1600&q=82', photoAlt: '東京夜晚的公園步道', localDate: '2024-10-04', localTime: '22:10', cityLabel: '東京', placeLabel: '代代木公園', caption: '夜裡走得很慢。', reason: '夜裡走得很慢，剛好需要一首不趕時間的歌。', reasonStatus: 'complete', sortOrder: 1, createdAt: '2024-10-04T13:10:00Z', updatedAt: '2024-10-04T13:10:00Z' },
  { id: 'tokyo-m3', journeyId: 'tokyo-2024', songReferenceId: 'song-tokyo-3', photoUrl: 'https://images.unsplash.com/photo-1436491865332-7a61a109cc05?auto=format&fit=crop&w=1600&q=82', photoAlt: '夕陽下準備起飛的客機', localDate: '2024-10-08', localTime: '18:20', cityLabel: '東京', placeLabel: '羽田機場', caption: '最後一段路。', reason: '', reasonStatus: 'needs_review', sortOrder: 2, createdAt: '2024-10-08T09:20:00Z', updatedAt: '2024-10-08T09:20:00Z' },
  { id: 'kyoto-m1', journeyId: 'kyoto-2023', songReferenceId: 'song-kyoto-1', photoUrl: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1600&q=82', photoAlt: '京都清晨的安靜街景', localDate: '2023-04-11', localTime: '07:30', cityLabel: '京都', placeLabel: '鴨川', caption: '清晨的顏色很淡。', reason: '早晨的顏色很淡，適合留白。', reasonStatus: 'complete', sortOrder: 0, createdAt: '2023-04-10T22:30:00Z', updatedAt: '2023-04-10T22:30:00Z' },
  { id: 'seoul-m1', journeyId: 'seoul-2025', songReferenceId: 'song-seoul-1', photoUrl: 'https://images.unsplash.com/photo-1637070875173-1ecab5fff748?auto=format&fit=crop&w=1600&q=82', photoAlt: '首爾漢江旁的城市夜景', localDate: '2025-10-14', localTime: '20:00', cityLabel: '首爾', placeLabel: '漢江公園', caption: '風吹過河面。', reason: '風吹過河面時，城市的聲音退到了後面。', reasonStatus: 'complete', sortOrder: 0, createdAt: '2025-10-14T11:00:00Z', updatedAt: '2025-10-14T11:00:00Z' },
];
