import React from "react";

type Props = {
  tests: string[];
  onDragStart: (name: string) => void;
  onQuickAdd: (name: string) => void;
};

export default function LibraryPanel({ tests, onDragStart, onQuickAdd }: Props) {
  return (
    <div className="tsq-card-body tsq-library-scroll">
      {tests.map((name) => (
        <div
          key={name}
          className="tsq-lib-item"
          draggable
          onDragStart={() => onDragStart(name)}
          onDoubleClick={() => onQuickAdd(name)}
          title="Drag to add • Double-click to add"
        >
          <div>
            <div className="tsq-lib-name">{name}</div>
            <div className="tsq-lib-sub">Drag to add</div>
          </div>
          <button
            className="tsq-icon-btn"
            onClick={() => onQuickAdd(name)}
            title="Quick Add"
          >
            +
          </button>
        </div>
      ))}
    </div>
  );
}
