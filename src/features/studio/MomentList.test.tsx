import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DragEndEvent } from '@dnd-kit/core';
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
    expect(screen.getAllByRole('option').map((item) => item.dataset.id)).toEqual([
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
    expect(screen.getAllByRole('option').map((item) => item.dataset.id)).toEqual([
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
});
