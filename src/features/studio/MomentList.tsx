import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react';
import { type KeyboardEvent, type MouseEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import type { JourneyEditorRepository } from '../../data/ports';
import type { JourneyMoment } from '../../domain/model';

interface MomentListProps {
  journeyId: string;
  moments: JourneyMoment[];
  selectedMomentId?: string;
  repository: Pick<JourneyEditorRepository, 'reorderMoments'>;
  onSelect: (momentId: string) => void;
  onOrderChange?: (orderedIds: string[]) => void;
  onReordered?: (orderedIds: string[]) => void | Promise<void>;
  headerActions?: ReactNode;
}

interface SortableMomentOptionProps {
  moment: JourneyMoment;
  index: number;
  count: number;
  selected: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
}

const chineseDigits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];

function chinesePosition(index: number) {
  const value = index + 1;
  if (value < 10) return `第${chineseDigits[value]}`;
  if (value === 10) return '第十';
  if (value < 20) return `第十${chineseDigits[value - 10]}`;
  if (value < 100) {
    const ones = value % 10;
    return `第${chineseDigits[Math.floor(value / 10)]}十${chineseDigits[ones]}`;
  }
  return `第${value}`;
}

function SortableMomentOption({
  moment,
  index,
  count,
  selected,
  onSelect,
  onMove,
}: SortableMomentOptionProps) {
  const position = chinesePosition(index);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: moment.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  const handleOptionKeyDown = (event: KeyboardEvent<HTMLLIElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect();
  };
  const stopAndMove = (event: MouseEvent<HTMLButtonElement>, direction: -1 | 1) => {
    event.stopPropagation();
    onMove(direction);
  };

  return (
    <li
      ref={setNodeRef}
      role="option"
      tabIndex={0}
      data-id={moment.id}
      aria-selected={selected}
      className={`${selected ? 'is-current' : ''}${isDragging ? ' is-dragging' : ''}`}
      style={style}
      onClick={onSelect}
      onKeyDown={handleOptionKeyDown}
    >
      <button
        className="moment-drag-handle"
        type="button"
        aria-label={`拖曳${position}則`}
        title={`拖曳${position}則`}
        {...attributes}
        {...listeners}
        onClick={(event) => event.stopPropagation()}
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <span className="moment-list-index">{String(index + 1).padStart(2, '0')}</span>
      <div className="moment-list-copy">
        <strong>{moment.song.title || '尚未填寫歌名'}</strong>
        <small>{moment.placeLabel || moment.cityLabel || moment.localDate}</small>
      </div>
      <div className="moment-order-actions">
        <button
          type="button"
          aria-label={`將${position}則上移`}
          title={`將${position}則上移`}
          disabled={index === 0}
          onClick={(event) => stopAndMove(event, -1)}
        >
          <ChevronUp size={15} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`將${position}則下移`}
          title={`將${position}則下移`}
          disabled={index === count - 1}
          onClick={(event) => stopAndMove(event, 1)}
        >
          <ChevronDown size={15} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export function MomentList({
  journeyId,
  moments,
  selectedMomentId,
  repository,
  onSelect,
  onOrderChange,
  onReordered,
  headerActions,
}: MomentListProps) {
  const [orderedMoments, setOrderedMoments] = useState(moments);
  const [reorderError, setReorderError] = useState('');
  const persistenceTailRef = useRef<Promise<void>>(Promise.resolve());
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useLayoutEffect(() => setOrderedMoments(moments), [moments]);

  const commitOrder = (nextMoments: JourneyMoment[]) => {
    const orderedIds = nextMoments.map((moment) => moment.id);
    setOrderedMoments(nextMoments);
    setReorderError('');
    onOrderChange?.(orderedIds);

    const persist = async () => {
      await repository.reorderMoments(journeyId, orderedIds);
      await onReordered?.(orderedIds);
    };
    const queued = persistenceTailRef.current.then(persist, persist);
    persistenceTailRef.current = queued.then(() => undefined, () => undefined);
    void queued.catch(() => setReorderError('無法儲存時刻順序，請再試一次。'));
  };

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= orderedMoments.length) return;
    commitOrder(arrayMove(orderedMoments, index, target));
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const activeIndex = orderedMoments.findIndex((moment) => moment.id === active.id);
    const overIndex = orderedMoments.findIndex((moment) => moment.id === over.id);
    if (activeIndex < 0 || overIndex < 0) return;
    commitOrder(arrayMove(orderedMoments, activeIndex, overIndex));
  };

  const renderedIds = orderedMoments.map((moment) => moment.id);

  return (
    <section className="journey-moment-list" aria-label="時刻清單">
      <div className="journey-region-heading">
        <h2>時刻</h2>
        <span>{orderedMoments.length}</span>
      </div>
      {headerActions}
      {orderedMoments.length === 0 ? (
        <p className="muted moment-list-empty">尚無時刻</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={renderedIds} strategy={verticalListSortingStrategy}>
            <ol role="listbox" aria-label="時刻排序">
              {orderedMoments.map((moment, index) => (
                <SortableMomentOption
                  key={moment.id}
                  moment={moment}
                  index={index}
                  count={orderedMoments.length}
                  selected={moment.id === selectedMomentId}
                  onSelect={() => onSelect(moment.id)}
                  onMove={(direction) => move(index, direction)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {reorderError && <p className="field-error" role="alert">{reorderError}</p>}
    </section>
  );
}
