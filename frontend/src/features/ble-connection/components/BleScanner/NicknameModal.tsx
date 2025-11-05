// frontend/src/features/ble-connection/components/BleScanner/NicknameModal.tsx

import { X } from "lucide-react";

interface NicknameModalProps {
  isOpen: boolean;
  nickname: string;
  onNicknameChange: (value: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export default function NicknameModal({
  isOpen,
  nickname,
  onNicknameChange,
  onSave,
  onClose,
}: NicknameModalProps) {
  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSave();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl p-6 w-96 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Assign Nickname</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <input
          className="tsq-input w-full mb-4"
          value={nickname}
          onChange={(e) => onNicknameChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter nickname"
          autoFocus
        />

        <div className="flex gap-2 justify-end">
          <button className="tsq-btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="tsq-btn primary" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}