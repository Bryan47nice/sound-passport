import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
import { useState } from 'react';
import type { JourneyMoment } from '../../domain/model';
import { MomentList } from './MomentList';

const dndHarness = vi.hoisted(() => ({
  onDragEnd: undefined as ((event: DragEndEvent) => void) | undefined,
  sortableItems: [] as string[],
}));

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>();
  return {
    ...actual,
    DndContext: ({ children, onDragEnd }: {
      children: React.ReactNode;
      onDragEnd: (event: DragEndEvent) => void;
    }) => {
      dndHarness.onDragEnd = onDragEnd;
      return children;
    },
  };
});

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/sortable')>();
  return {
    ...actual,
    SortableContext: ({ children, items }: { children: React.ReactNode; items: string[] }) => {
      dndHarness.sortableItems = [...items];
      return children;
    },
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
  };
});

function makeMoment(id: string, title: string, sortOrder: number): JourneyMoment {
  return {
    id,
    journeyId: 'journey-1',
    photoAssetId: `photo-${id}`,
    photoAlt: `${title} 照片`,
    songReferenceId: `song-${id}`,
    localDate: `2026-07-${String(sortOrder + 11).padStart(2, '0')}`,
    cityLabel: '台北',
    placeLabel: '',
    caption: '',
    reason: '',
    reasonStatus: 'needs_review',
    sortOrder,
    createdAt: '2026-07-13T00:00:00.000Z',
    updatedAt: '2026-07-13T00:00:00.000Z',
    song: {
      id: `song-${id}`,
      provider: 'manual',
      title,
      artist: '測試歌手',
      availability: 'needs_link',
    },
  };
}

const moments = [
  makeMoment('first', '第一首', 0),
  makeMoment('second', '第二首', 1),
  makeMoment('third', '第三首', 2),
];

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function selectionButtons() {
  return [...document.querySelectorAll<HTMLButtonElement>('[data-moment-select]')];
}

function orderedRowIds() {
  return [...document.querySelectorAll<HTMLElement>('[data-moment-row]')]
    .map((row) => row.dataset.id);
}

function SelectableMomentList({ onSelect }: { onSelect: (momentId: string) => void }) {
  const [selectedMomentId, setSelectedMomentId] = useState('first');
  return (
    <MomentList
      journeyId="journey-1"
      moments={moments}
      selectedMomentId={selectedMomentId}
      repository={{ reorderMoments: vi.fn(async () => undefined) }}
      onSelect={(momentId) => {
        setSelectedMomentId(momentId);
        onSelect(momentId);
      }}
    />
  );
}

function ReorderPropHarness({
  reorderMoments,
  onReordered,
}: {
  reorderMoments: (journeyId: string, orderedIds: string[]) => Promise<void>;
  onReordered: (orderedIds: string[]) => void | Promise<void>;
}) {
  const [propMoments, setPropMoments] = useState(moments);
  const momentsById = new Map(moments.map((moment) => [moment.id, moment]));
  return (
    <MomentList
      journeyId="journey-1"
      moments={propMoments}
      selectedMomentId="first"
      repository={{ reorderMoments }}
      onSelect={vi.fn()}
      onOrderChange={(orderedIds) => {
        setPropMoments(orderedIds.map((id) => momentsById.get(id)!));
      }}
      onReordered={async (orderedIds) => {
        await onReordered(orderedIds);
        setPropMoments(moments);
      }}
    />
  );
}

describe('MomentList', () => {
  afterEach(cleanup);

  beforeEach(() => {
    dndHarness.onDragEnd = undefined;
    dndHarness.sortableItems = [];
  });

  it('moves a moment with its accessible button and immediately publishes the full order', async () => {
    const user = userEvent.setup();
    const reorderMoments = vi.fn(async () => undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments }}
        onSelect={vi.fn()}
      />,
    );

    expect(dndHarness.sortableItems).toEqual(['first', 'second', 'third']);
    await user.click(screen.getByRole('button', { name: '將第二則上移' }));

    expect(reorderMoments).toHaveBeenCalledWith('journey-1', ['second', 'first', 'third']);
    expect(orderedRowIds()).toEqual([
      'second',
      'first',
      'third',
    ]);
    expect(dndHarness.sortableItems).toEqual(['second', 'first', 'third']);
  });

  it('uses the DnD callback to persist and render the complete reordered id list', async () => {
    const reorderMoments = vi.fn(async () => undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments }}
        onSelect={vi.fn()}
      />,
    );

    await act(async () => {
      dndHarness.onDragEnd?.({
        active: { id: 'third' },
        over: { id: 'first' },
      } as DragEndEvent);
      await Promise.resolve();
    });

    await waitFor(() => expect(reorderMoments).toHaveBeenCalledWith(
      'journey-1',
      ['third', 'first', 'second'],
    ));
    expect(orderedRowIds()).toEqual([
      'third',
      'first',
      'second',
    ]);
    expect(dndHarness.sortableItems).toEqual(['third', 'first', 'second']);
  });

  it('does not select an option when keyboard interaction starts from its drag handle', () => {
    const onSelect = vi.fn();
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments: vi.fn(async () => undefined) }}
        onSelect={onSelect}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: '拖曳第二則' }), { key: ' ' });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('uses semantic list rows with independent selection and ordering controls', () => {
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments: vi.fn(async () => undefined) }}
        onSelect={vi.fn()}
      />,
    );

    const list = screen.getByRole('list', { name: '時刻排序' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('option')).not.toBeInTheDocument();
    rows.forEach((row, index) => {
      const select = within(row).getByRole('button', { name: new RegExp(`選取第${index + 1}則時刻`) });
      expect(select).toHaveAttribute('data-moment-select');
      expect(within(select).queryByRole('button')).not.toBeInTheDocument();
      expect(within(row).getByRole('button', { name: new RegExp(`拖曳第[一二三]則`) })).not.toBe(select);
    });
  });

  it('uses one roving selection button and Arrow, Home, and End keys to focus and select rows', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SelectableMomentList onSelect={onSelect} />);
    const options = selectionButtons();

    expect(options.map((option) => option.tabIndex)).toEqual([0, -1, -1]);
    options[0].focus();
    await user.keyboard('{ArrowUp}');
    expect(options[0]).toHaveFocus();
    expect(options[0]).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{ArrowDown}');
    expect(options[1]).toHaveFocus();
    expect(options[1]).toHaveAttribute('aria-pressed', 'true');
    expect(options.map((option) => option.tabIndex)).toEqual([-1, 0, -1]);

    await user.keyboard('{End}');
    expect(options[2]).toHaveFocus();
    expect(options[2]).toHaveAttribute('aria-pressed', 'true');
    await user.keyboard('{ArrowDown}');
    expect(options[2]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(options[0]).toHaveFocus();
    expect(options[0]).toHaveAttribute('aria-pressed', 'true');
    expect(onSelect.mock.calls.map(([id]) => id)).toEqual(['first', 'second', 'third', 'third', 'first']);
  });

  it('selects a focused option with Enter or Space while isolating the keyboard drag handle', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<SelectableMomentList onSelect={onSelect} />);
    const options = selectionButtons();

    options[1].focus();
    await user.keyboard('{Enter}');
    expect(options[1]).toHaveAttribute('aria-pressed', 'true');
    expect(options[1].tabIndex).toBe(0);

    options[2].focus();
    await user.keyboard(' ');
    expect(options[2]).toHaveAttribute('aria-pressed', 'true');
    expect(options[2].tabIndex).toBe(0);

    const callsBeforeDrag = onSelect.mock.calls.length;
    const dragHandle = screen.getByRole('button', { name: '拖曳第二則' });
    dragHandle.focus();
    await user.keyboard(' ');
    expect(dragHandle).toHaveFocus();
    expect(onSelect).toHaveBeenCalledTimes(callsBeforeDrag);
  });

  it('serializes three rapid orders, keeps the latest optimistic order, and refreshes only after drain', async () => {
    const firstWrite = deferred<void>();
    const secondWrite = deferred<void>();
    const thirdWrite = deferred<void>();
    const reorderMoments = vi.fn()
      .mockImplementationOnce(() => firstWrite.promise)
      .mockImplementationOnce(() => secondWrite.promise)
      .mockImplementationOnce(() => thirdWrite.promise);
    const onReordered = vi.fn(async () => undefined);
    render(<ReorderPropHarness reorderMoments={reorderMoments} onReordered={onReordered} />);

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    fireEvent.click(screen.getByRole('button', { name: '將第三則上移' }));
    fireEvent.click(screen.getByRole('button', { name: '將第一則下移' }));
    await act(flushMicrotasks);

    expect(orderedRowIds()).toEqual([
      'third',
      'second',
      'first',
    ]);
    expect(reorderMoments).toHaveBeenCalledTimes(1);
    expect(reorderMoments).toHaveBeenNthCalledWith(1, 'journey-1', ['second', 'first', 'third']);

    await act(async () => {
      firstWrite.resolve();
      await firstWrite.promise;
      await flushMicrotasks();
    });
    expect(onReordered).not.toHaveBeenCalled();
    expect(reorderMoments).toHaveBeenCalledTimes(2);
    expect(reorderMoments).toHaveBeenNthCalledWith(2, 'journey-1', ['second', 'third', 'first']);

    await act(async () => {
      secondWrite.resolve();
      await secondWrite.promise;
      await flushMicrotasks();
    });
    expect(onReordered).not.toHaveBeenCalled();
    expect(reorderMoments).toHaveBeenCalledTimes(3);
    expect(reorderMoments).toHaveBeenNthCalledWith(3, 'journey-1', ['third', 'second', 'first']);

    await act(async () => {
      thirdWrite.resolve();
      await thirdWrite.promise;
      await flushMicrotasks();
    });
    expect(onReordered).toHaveBeenCalledTimes(1);
    expect(onReordered).toHaveBeenCalledWith(['third', 'second', 'first']);
    expect(orderedRowIds()).toEqual([
      'third',
      'second',
      'first',
    ]);
  });

  it('recovers from an intermediate persistence failure by committing the latest queued order', async () => {
    const reorderMoments = vi.fn()
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce(undefined);
    const onReordered = vi.fn(async () => undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments }}
        onSelect={vi.fn()}
        onReordered={onReordered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    fireEvent.click(screen.getByRole('button', { name: '將第三則上移' }));

    await waitFor(() => expect(reorderMoments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onReordered).toHaveBeenCalledWith(['second', 'third', 'first']));
    expect(screen.queryByText('無法儲存時刻順序，請再試一次。')).not.toBeInTheDocument();
    expect(orderedRowIds()).toEqual([
      'second',
      'third',
      'first',
    ]);
  });

  it('does not persist a reorder until a failed pre-reorder flush is retried', async () => {
    const onBeforeReorder = vi.fn()
      .mockRejectedValueOnce(new Error('moment save failed'))
      .mockResolvedValueOnce(undefined);
    const reorderMoments = vi.fn(async () => undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments }}
        onSelect={vi.fn()}
        onBeforeReorder={onBeforeReorder}
      />,
    );

    const firstOption = document.querySelector<HTMLElement>('[data-moment-row]');
    expect(firstOption).not.toBeNull();
    const moveDown = firstOption!.querySelector<HTMLButtonElement>('.moment-order-actions button:last-child');
    expect(moveDown).not.toBeNull();
    fireEvent.click(moveDown!);
    await act(flushMicrotasks);

    expect(onBeforeReorder).toHaveBeenCalledTimes(1);
    expect(reorderMoments).not.toHaveBeenCalled();
    expect(orderedRowIds()).toEqual([
      'second',
      'first',
      'third',
    ]);
    const alert = await screen.findByRole('alert');
    const retry = alert.querySelector<HTMLButtonElement>('button');
    expect(retry).not.toBeNull();

    fireEvent.click(retry!);
    await waitFor(() => expect(reorderMoments).toHaveBeenCalledTimes(1));

    expect(onBeforeReorder).toHaveBeenCalledTimes(2);
    expect(reorderMoments).toHaveBeenCalledWith('journey-1', ['second', 'first', 'third']);
    expect(orderedRowIds()).toEqual([
      'second',
      'first',
      'third',
    ]);
  });

  it('retries the latest failed persistence with the same full order', async () => {
    const reorderMoments = vi.fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);
    const onReordered = vi.fn(async () => undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments }}
        onSelect={vi.fn()}
        onReordered={onReordered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    expect(await screen.findByText('無法儲存時刻順序，請再試一次。')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '重試儲存' }));
    await waitFor(() => expect(reorderMoments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onReordered).toHaveBeenCalledTimes(1));
    expect(reorderMoments).toHaveBeenLastCalledWith('journey-1', ['second', 'first', 'third']);
    expect(screen.queryByText('無法儲存時刻順序，請再試一次。')).not.toBeInTheDocument();
  });

  it('retries only refresh after persistence has committed', async () => {
    const reorderMoments = vi.fn(async () => undefined);
    const onReordered = vi.fn()
      .mockRejectedValueOnce(new Error('refresh failed'))
      .mockResolvedValueOnce(undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments }}
        onSelect={vi.fn()}
        onReordered={onReordered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    expect(await screen.findByText('順序已儲存，但重新載入失敗。')).toBeInTheDocument();
    expect(reorderMoments).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    await waitFor(() => expect(onReordered).toHaveBeenCalledTimes(2));
    expect(reorderMoments).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('順序已儲存，但重新載入失敗。')).not.toBeInTheDocument();
  });

  it('registers pending reorder work and keeps flush pending through persistence and refresh', async () => {
    const write = deferred<void>();
    const refresh = deferred<void>();
    const registrations: Array<{ dirty: boolean; flush: () => Promise<void> } | undefined> = [];
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments: vi.fn(() => write.promise) }}
        onSelect={vi.fn()}
        onReordered={() => refresh.promise}
        {...({ onPendingChange: (registration: any) => registrations.push(registration) } as any)}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));
    await act(flushMicrotasks);
    const pending = registrations.at(-1);
    expect(pending).toMatchObject({ dirty: true });
    let flushed = false;
    const flush = pending!.flush().then(() => { flushed = true; });

    await act(async () => {
      write.resolve();
      await write.promise;
      await flushMicrotasks();
    });
    expect(flushed).toBe(false);

    await act(async () => {
      refresh.resolve();
      await refresh.promise;
      await flush;
    });
    expect(flushed).toBe(true);
    expect(registrations.at(-1)).toMatchObject({ dirty: false });
  });

  it.each([
    {
      label: 'concurrent add',
      currentMoments: [...moments, makeMoment('fourth', '第四首', 3)],
      expected: ['second', 'first', 'third', 'fourth'],
    },
    {
      label: 'concurrent delete',
      currentMoments: [moments[0], moments[2]],
      expected: ['first', 'third'],
    },
  ])('rebases the requested relative order after a $label', async ({ currentMoments, expected }) => {
    const conflict = Object.assign(new Error('moment set changed'), { name: 'MomentOrderConflictError' });
    const reorderMoments = vi.fn()
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce(undefined);
    const getPrivateJourneyStory = vi.fn(async () => ({
      journey: {
        id: 'journey-1', title: '旅程', countryCode: 'TW', countryName: '臺灣',
        countryCoordinates: [121, 25] as [number, number], cityLabels: ['台北'],
        startDate: '2026-07-11', endDate: '2026-07-20', summary: '', status: 'draft' as const,
        createdAt: '2026-07-11T00:00:00.000Z', updatedAt: '2026-07-13T00:00:00.000Z',
        source: 'private' as const,
      },
      moments: currentMoments,
    }));
    const onReordered = vi.fn(async () => undefined);
    render(
      <MomentList
        journeyId="journey-1"
        moments={moments}
        selectedMomentId="first"
        repository={{ reorderMoments, getPrivateJourneyStory } as any}
        onSelect={vi.fn()}
        onReordered={onReordered}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '將第二則上移' }));

    await waitFor(() => expect(reorderMoments).toHaveBeenCalledTimes(2));
    expect(getPrivateJourneyStory).toHaveBeenCalledWith('journey-1');
    expect(reorderMoments).toHaveBeenNthCalledWith(1, 'journey-1', ['second', 'first', 'third']);
    expect(reorderMoments).toHaveBeenNthCalledWith(2, 'journey-1', expected);
    expect(onReordered).toHaveBeenCalledWith(expected);
  });
});
