// frontend/src/features/ble-connection/components/BleScanner/DeviceTable.tsx

import { Bluetooth, Edit3 } from "lucide-react";
import type { BleDevice } from "../../types/ble.types";
import { tagPalette } from "../../utils/colorUtils";

interface DeviceTableProps {
  devices: BleDevice[];
  selectedFamilyLabel: string;
  onOpenAssign: (mac: string, currentNickname?: string | null) => void;
  onToggleConnect: (device: BleDevice) => void;
}

export default function DeviceTable({
  devices,
  selectedFamilyLabel,
  onOpenAssign,
  onToggleConnect,
}: DeviceTableProps) {
  if (devices.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
        <Bluetooth size={48} className="mb-2 opacity-30" />
        <p className="text-sm">No {selectedFamilyLabel} devices found</p>
        <p className="text-xs mt-1">Click Scan to discover devices</p>
      </div>
    );
  }

  return (
    <div className="table-wrapper">
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 sticky top-0 z-10">
          <tr className="text-left text-zinc-500">
            <th className="py-2 px-4">Device</th>
            <th className="py-2 px-4">MAC Address</th>
            <th className="py-2 px-4">RSSI</th>
            <th className="py-2 px-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((d) => {
            const displayName = d.nickname || d.rawName || d.mac;
            const hasNickname = !!d.nickname;
            const palette = hasNickname ? tagPalette(d.nickname!) : null;

            return (
              <tr key={d.mac} className="border-t border-zinc-200">
                {/* Device Name/Nickname */}
                <td className="py-2 px-4">
                  <div className="flex items-center gap-2">
                    <Bluetooth size={16} className="text-zinc-400" />
                    {hasNickname ? (
                      <span
                        className="px-2 py-1 rounded text-xs font-medium"
                        style={{
                          background: palette!.bg,
                          border: `1px solid ${palette!.border}`,
                          color: palette!.text,
                        }}
                      >
                        {displayName}
                      </span>
                    ) : (
                      <span className="text-zinc-700">{displayName}</span>
                    )}
                  </div>
                </td>

                {/* MAC Address */}
                <td className="py-2 px-4 font-mono text-xs text-zinc-500">
                  {d.mac}
                </td>

                {/* RSSI */}
                <td className="py-2 px-4 text-zinc-600">
                  {d.rssi != null ? `${d.rssi} dBm` : "—"}
                </td>

                {/* Actions */}
                <td className="py-2 px-4">
                  <div className="flex items-center gap-2">
                    {/* Assign Nickname */}
                    <button
                      className="tsq-icon-btn"
                      onClick={() => onOpenAssign(d.mac, d.nickname)}
                      title="Assign nickname"
                    >
                      <Edit3 size={14} />
                    </button>

                    {/* Connect/Disconnect */}
                    <button
                      className={`tsq-btn ${d.connected ? "ghost" : "primary"}`}
                      onClick={() => onToggleConnect(d)}
                      disabled={d.connecting}
                    >
                      {d.connecting
                        ? "Connecting..."
                        : d.connected
                        ? "Disconnect"
                        : "Connect"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}