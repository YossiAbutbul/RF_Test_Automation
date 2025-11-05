// frontend/src/features/test-sequences/hooks/useDragAndDrop.ts

import { useState } from "react";
import type { DragState } from "../types/sequence.types";

export function useDragAndDrop() {
  const [dragState, setDragState] = useState<DragState>({
    draggingCardId: null,
    dragOverCardId: null,
    dragOverEdge: null,
    draggingLibTest: null,
    fileDragActive: false,
  });

  const onCardDragStart = (_: React.DragEvent<HTMLDivElement>, id: number) => {
    setDragState((prev) => ({ ...prev, draggingCardId: id }));
  };

  const onCardDragOver = (e: React.DragEvent<HTMLDivElement>, id: number) => {
    e.preventDefault();
    if (dragState.draggingCardId == null) return;

    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const mid = rect.top + rect.height / 2;

    setDragState((prev) => ({
      ...prev,
      dragOverCardId: id,
      dragOverEdge: e.clientY < mid ? "above" : "below",
    }));
  };

  const onCardDragEnd = () => {
    setDragState((prev) => ({
      ...prev,
      draggingCardId: null,
      dragOverCardId: null,
      dragOverEdge: null,
    }));
  };

  const onLibraryDragStart = (testName: string) => {
    setDragState((prev) => ({ ...prev, draggingLibTest: testName }));
  };

  const onLibraryDragEnd = () => {
    setDragState((prev) => ({ ...prev, draggingLibTest: null }));
  };

  const onFileDragEnter = (e: React.DragEvent) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      setDragState((prev) => ({ ...prev, fileDragActive: true }));
    }
  };

  const onFileDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragState((prev) => ({ ...prev, fileDragActive: false }));
    }
  };

  const clearFileDrag = () => {
    setDragState((prev) => ({ ...prev, fileDragActive: false }));
  };

  return {
    dragState,
    onCardDragStart,
    onCardDragOver,
    onCardDragEnd,
    onLibraryDragStart,
    onLibraryDragEnd,
    onFileDragEnter,
    onFileDragLeave,
    clearFileDrag,
  };
}