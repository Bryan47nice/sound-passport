import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RepositoryProvider } from '../../data/RepositoryContext';
import { fixtureJourneyRepository } from '../../data/fixtureJourneyRepository';
import type { JourneyEditorRepository } from '../../data/ports';
import { findCountry } from '../../domain/countryCatalog';
import { JourneyCreatePage } from './JourneyCreatePage';

type RecoveryPageProps = { onBootstrapRetry: () => void };
const RecoveryJourneyCreatePage = JourneyCreatePage as unknown as (props: RecoveryPageProps) => ReactElement;

function editorStub(): JourneyEditorRepository {
  return {
    listPrivateJourneys: vi.fn(), getPrivateJourneyStory: vi.fn(), createJourney: vi.fn(async (input) => ({ ...input, id: 'new-journey', status: 'draft', source: 'private', createdAt: '2024-05-01T00:00:00.000Z', updatedAt: '2024-05-01T00:00:00.000Z' })),
    updateJourney: vi.fn(), deleteJourney: vi.fn(), addMoments: vi.fn(), updateMoment: vi.fn(),
    deleteMoment: vi.fn(), reorderMoments: vi.fn(), setJourneyStatus: vi.fn(),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

function renderPage(editor = editorStub()) {
  render(
    <RepositoryProvider services={{ query: fixtureJourneyRepository, editor }}>
      <MemoryRouter initialEntries={['/studio/journeys/new']}>
        <Routes>
          <Route path="/studio/journeys/new" element={<JourneyCreatePage />} />
          <Route path="/studio/journeys/:journeyId" element={<h1>編輯器目標</h1>} />
        </Routes>
      </MemoryRouter>
    </RepositoryProvider>,
  );
  return editor;
}

describe('JourneyCreatePage', () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('requires a title, selected country, and valid date range', async () => {
    const user = userEvent.setup();
    const editor = renderPage();

    await user.click(screen.getByRole('button', { name: '建立旅程' }));
    expect(editor.createJourney).not.toHaveBeenCalled();
    expect(await screen.findAllByText('請填寫此欄位')).toHaveLength(4);

    await user.type(screen.getByLabelText(/旅程標題/), '春天散步');
    await user.type(screen.getByLabelText(/開始日期/), '2024-05-03');
    await user.type(screen.getByLabelText(/結束日期/), '2024-05-02');
    await user.click(screen.getByRole('button', { name: '建立旅程' }));
    expect(await screen.findByText('結束日期不得早於開始日期')).toBeInTheDocument();
  });

  it('writes the catalog country atomically, manages city chips, and navigates after creation', async () => {
    const user = userEvent.setup();
    const editor = renderPage();

    await user.type(screen.getByLabelText('旅程標題'), '春天散步');
    await user.type(screen.getByLabelText('國家'), '日本');
    await user.type(screen.getByLabelText('開始日期'), '2024-05-01');
    await user.type(screen.getByLabelText('結束日期'), '2024-05-03');
    await user.type(screen.getByLabelText('城市'), '東京');
    await user.click(screen.getByRole('button', { name: '新增城市' }));
    expect(screen.getByRole('listitem', { name: '東京' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '移除城市 東京' }));
    expect(screen.queryByRole('listitem', { name: '東京' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('城市'), '東京');
    await user.click(screen.getByRole('button', { name: '新增城市' }));
    await user.click(screen.getByRole('button', { name: '建立旅程' }));

    expect(editor.createJourney).toHaveBeenCalledWith(expect.objectContaining({
      title: '春天散步', countryCode: 'JP', countryName: '日本', countryCoordinates: findCountry('JP')?.coordinates, cityLabels: ['東京'],
    }));
    expect(await screen.findByRole('heading', { name: '編輯器目標' })).toBeInTheDocument();
  });

  it('disables submission and creates exactly once during a deferred double-click', async () => {
    const user = userEvent.setup();
    const creation = deferred<Awaited<ReturnType<JourneyEditorRepository['createJourney']>>>();
    const editor = editorStub();
    vi.mocked(editor.createJourney).mockImplementation(() => creation.promise);
    renderPage(editor);
    await user.type(screen.getByLabelText('旅程標題'), '春天散步');
    await user.type(screen.getByLabelText('國家'), '日本');
    await user.type(screen.getByLabelText('開始日期'), '2024-05-01');
    await user.type(screen.getByLabelText('結束日期'), '2024-05-03');

    await user.dblClick(screen.getByRole('button', { name: '建立旅程' }));

    expect(editor.createJourney).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '建立中…' })).toBeDisabled();
    creation.resolve({
      id: 'new-journey', title: '春天散步', countryCode: 'JP', countryName: '日本', countryCoordinates: [139.6917, 35.6895],
      cityLabels: [], startDate: '2024-05-01', endDate: '2024-05-03', summary: '', status: 'draft', source: 'private',
      createdAt: '2024-05-01T00:00:00.000Z', updatedAt: '2024-05-01T00:00:00.000Z',
    });
    expect(await screen.findByRole('heading', { name: '編輯器目標' })).toBeInTheDocument();
  });

  it('retries bootstrap when the editor service is unavailable', async () => {
    const user = userEvent.setup();
    const onBootstrapRetry = vi.fn();
    render(
      <RepositoryProvider services={{ query: fixtureJourneyRepository }}>
        <MemoryRouter><RecoveryJourneyCreatePage onBootstrapRetry={onBootstrapRetry} /></MemoryRouter>
      </RepositoryProvider>,
    );

    await user.click(screen.getByRole('button', { name: '重新嘗試' }));
    expect(onBootstrapRetry).toHaveBeenCalledTimes(1);
  });

  it('shows mobile guidance and suppresses every editable control', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })));
    renderPage();

    expect(screen.getByRole('heading', { name: '請使用電腦整理旅程' })).toBeInTheDocument();
    expect(document.querySelector('form')).not.toBeInTheDocument();
    expect(document.querySelector('input')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '建立旅程' })).not.toBeInTheDocument();
  });
});
