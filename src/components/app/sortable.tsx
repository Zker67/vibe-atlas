import type { CSSProperties, ReactNode } from "react";
import { closestCenter, DndContext, type DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn } from "@/lib/utils";

interface SortableListProps {
  ids: number[];
  /** Called when a row was dropped on another: after it when moved down. */
  onMove(id: number, overId: number, after: boolean): void;
  children: ReactNode;
}

/**
 * A vertical list whose rows the mouse drags into another order. A drag
 * starts once the pointer moved a few pixels, so a click still selects.
 */
export function SortableList({ ids, onMove, children }: SortableListProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(Number(active.id));
    const to = ids.indexOf(Number(over.id));
    if (from < 0 || to < 0) return;
    onMove(Number(active.id), Number(over.id), to > from);
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

/** What a row of a SortableList spreads on its element. */
export function useSortableRow(id: number) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: CSSProperties = {
    transform: CSS.Translate.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };
  return { ref: setNodeRef, style, listeners, isDragging };
}

/** A row of a SortableList: the mouse drags it by any part of it. */
export function SortableRow({ id, children }: { id: number; children: ReactNode }) {
  const { ref, style, listeners, isDragging } = useSortableRow(id);
  return (
    <div ref={ref} style={style} {...listeners} className={cn("rounded-md", isDragging && "bg-background opacity-90 shadow-md")}>
      {children}
    </div>
  );
}
