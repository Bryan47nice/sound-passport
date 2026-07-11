import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('App', () => {
  it('renders the Sound Passport shell', () => {
    render(<MemoryRouter><App /></MemoryRouter>);
    expect(screen.getByRole('banner')).toHaveTextContent('Sound Passport');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});
