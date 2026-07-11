import { describe, expect, it } from 'vitest';
import { buildYouTubeEmbedUrl, isValidYouTubeVideoId, parseYouTubeVideoId } from './youtube';

describe('YouTube adapter', () => {
  it.each([
    ['https://youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://www.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://music.youtube.com/watch?v=M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://youtu.be/M7lc1UVf-VE', 'M7lc1UVf-VE'],
    ['https://www.youtube.com/shorts/M7lc1UVf-VE', 'M7lc1UVf-VE'],
  ])('extracts a video id from an approved YouTube URL: %s', (url, expected) => {
    expect(parseYouTubeVideoId(url)).toBe(expected);
  });

  it.each([
    ['', false],
    ['   ', false],
    ['M7lc1UVf-!E', false],
    ['too-short', false],
    ['M7lc1UVf-VE0', false],
    ['M7lc1UVf-VE', true],
  ])('validates the required 11-character video-id format: %s', (videoId, expected) => {
    expect(isValidYouTubeVideoId(videoId)).toBe(expected);
  });

  it.each([
    'https://example.com/watch?v=M7lc1UVf-VE',
    'https://notyoutube.com/watch?v=M7lc1UVf-VE',
    'https://youtube.com.evil.example/watch?v=M7lc1UVf-VE',
    'https://youtube-nocookie.com/embed/M7lc1UVf-VE',
    'not a url',
  ])('rejects an unapproved or malformed URL: %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeUndefined();
  });

  it.each([
    'https://youtube.com/watch?v=',
    'https://youtube.com/watch?v=%20%20%20',
    'https://youtube.com/watch?v=M7lc1UVf-!E',
    'https://youtu.be/too-short',
    'https://www.youtube.com/shorts/M7lc1UVf-VE0',
  ])('rejects a URL with a missing or invalid video id: %s', (url) => {
    expect(parseYouTubeVideoId(url)).toBeUndefined();
  });

  it('builds a privacy-enhanced embed with autoplay disabled', () => {
    const url = buildYouTubeEmbedUrl('M7lc1UVf-VE');

    expect(url).toContain('youtube-nocookie.com');
    expect(url).toContain('autoplay=0');
  });
});
