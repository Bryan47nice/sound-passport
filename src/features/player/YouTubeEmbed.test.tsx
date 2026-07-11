import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SongReference } from '../../domain/model';
import { YouTubeEmbed } from './YouTubeEmbed';

function song(overrides: Partial<SongReference>): SongReference {
  return {
    id: 'test-song',
    provider: 'youtube',
    title: 'Test track',
    artist: 'Test artist',
    availability: 'available',
    ...overrides,
  };
}

describe('YouTubeEmbed', () => {
  it.each([undefined, '', '   ', 'M7lc1UVf-!E', 'M7lc1UVf-VE0'])('falls back to a valid source URL when providerItemId is invalid: %s', (providerItemId) => {
    const { container } = render(<YouTubeEmbed song={song({ providerItemId, sourceUrl: 'https://www.youtube.com/watch?v=M7lc1UVf-VE' })} />);

    expect(within(container).getByTitle('YouTube player')).toHaveAttribute('src', expect.stringContaining('/M7lc1UVf-VE?'));
  });

  it('renders fallback content when both providerItemId and sourceUrl are invalid', () => {
    const { container } = render(<YouTubeEmbed song={song({ providerItemId: 'not-valid', sourceUrl: 'https://www.youtube.com/watch?v=bad' })} />);
    const player = within(container);

    expect(player.queryByTitle('YouTube player')).not.toBeInTheDocument();
    expect(player.getByText('Test track', { selector: '.song-fallback strong' })).toBeInTheDocument();
  });
});
