import { useEffect, useMemo, useState } from "react";
import { Card } from "@/shared/components/ui/Card";
import { Bluetooth, Edit3, RefreshCcw, X, StopCircle } from "lucide-react";
import { useAppStore } from "@/state/appStore";
import type { ProjectFamily, BleDevice } from "@/state/appStore";

/** deterministic color palette for nickname pill */
function hslFromLabel(label: string) {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const s = 65, l = 46;
  return { hue, s, l };
}
function tagPalette(label: string) {
  const { hue, s, l } = hslFromLabel(label);
  return {
    bg: `hsla(${hue}deg, ${s}%, ${l}%, 0.12)`,
    border: `hsla(${hue}deg, ${s}%, ${l}%, 0.35)`,
    text: l >= 60 ? "#1f2937" : "#111111",
  };
}

export default function BleScanner() {
  // ------------ Store selectors ------------
  const projectFamilies = useAppStore((s) => s.config.projectFamilies) as ProjectFamily[];
  const selectedFamilyId = useAppStore((s) => s.config.selectedFamilyId) as string;

  const bleDevices = useAppStore((s) => s.ble.devices) as BleDevice[];
  const scanning = useAppStore((s) => s.ble.scanning);
  const scanEndsAt = useAppStore((s) => s.ble.scanEndsAt);

  const nicknameModalOpen = useAppStore((s) => s.ble.nicknameModalOpen);
  const nicknameModalMac = useAppStore((s) => s.ble.nicknameModalMac);
  const nicknameDraft = useAppStore((s) => s.ble.nicknameDraft);

  // ------------ Actions ------------
  const loadProjectFamilies = useAppStore((s) => s.actions.loadProjectFamilies);
  const setSelectedFamily = useAppStore((s) => s.actions.setSelectedFamily);

  const bleScanStream = useAppStore((s) => s.actions.bleScanStream);
  const cancelBleScan = useAppStore((s) => s.actions.cancelBleScan);

  const bleAssign = useAppStore((s) => s.actions.bleAssign);
  const bleConnect = useAppStore((s) => s.actions.bleConnect);
  const bleDisconnect = useAppStore((s) => s.actions.bleDisconnect);

  const openNicknameModal = useAppStore((s) => s.actions.openNicknameModal);
  const closeNicknameModal = useAppStore((s) => s.actions.closeNicknameModal);
  const setNicknameDraft = useAppStore((s) => s.actions.setNicknameDraft);
  const saveNickname = useAppStore((s) => s.actions.saveNickname);

  // ------------ Effects ------------
  useEffect(() => {
    loadProjectFamilies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedFamilyLabel = useMemo(
    () => projectFamilies.find((f) => f.id === selectedFamilyId)?.label ?? "",
    [projectFamilies, selectedFamilyId]
  );

  // small timer for scan countdown display
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!scanning || !scanEndsAt) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [scanning, scanEndsAt]);
  const scanSecondsLeft = useMemo(() => {
    if (!scanning || !scanEndsAt) return null;
    const ms = Math.max(0, scanEndsAt - now);
    return Math.ceil(ms / 1000);
  }, [scanning, scanEndsAt, now]);

  // ------------ Handlers ------------
  const handleScan = () => {
    if (!selectedFamilyId) return;
    bleScanStream();
  };
  const handleCancel = () => cancelBleScan();

  const handleOpenAssign = (mac: string, currentNickname?: string | null) =>
    openNicknameModal(mac, currentNickname ?? undefined);

  const handleAssignSave = () => {
    if (!nicknameModalMac) return;
    const nick = nicknameDraft.trim();
    saveNickname(nicknameModalMac, nick);
    if (selectedFamilyId) bleAssign(nicknameModalMac, selectedFamilyId);
  };

  const handleToggleConnect = async (d: BleDevice) => {
    if (d.connected) await bleDisconnect(d.mac);
    else await bleConnect(d.mac);
  };

  return (
    <Card className="dut-connection-card lg:col-span-2 p-0">
      {/* Fixed controls area */}
      <div className="controls">
        <div className="text-base font-medium">DUT Connection</div>
        <div className="text-sm text-zinc-500">Connect to Device Under Test</div>

        {/* Project family + Scan/Stop */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="tsq-field-label">Project family</label>
            <select
              className="tsq-select"
              value={selectedFamilyId || ""}
              onChange={(e) => setSelectedFamily(e.target.value)}
            >
              {projectFamilies.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              className="tsq-btn ghost"
              onClick={handleScan}
              disabled={scanning || !selectedFamilyId}
              title={selectedFamilyId ? "Scan for BLE devices" : "Select a project family first"}
            >
              <RefreshCcw className={`h-4 w-4 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? "Scanning…" : "Scan"}
              {scanning && (
                <span className="ml-1 text-xs text-zinc-500">
                  {scanSecondsLeft ?? ""}{scanSecondsLeft !== null ? "s" : ""}
                </span>
              )}
            </button>

            {scanning && (
              <button
                className="tsq-btn ghost"
                onClick={handleCancel}
                title="Stop scan"
              >
                <StopCircle className="h-4 w-4" />
                Stop
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable table area */}
      <div className="table-scroll">
        <div className="overflow-hidden">
          <table className="w-full text-sm table-fixed">
            <colgroup>
              {/* Device: enough room for icon + 2 lines */}
              <col className="w-[32%]" />
              {/* RSSI: compact */}
              <col className="w-[14%]" />
              {/* Nickname: take the rest */}
              <col />
              {/* Change Nickname: small button column */}
              <col className="w-[10%]" />
              {/* Action: connect/disconnect */}
              <col className="w-[15%]" />
            </colgroup>

            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Device</th>
                <th className="text-left px-4 py-2 font-medium">RSSI</th>
                <th className="text-left px-4 py-2 font-medium">Nickname</th>
                <th className="text-left px-4 py-2 font-medium">Edit</th>
                <th className="text-right px-4 py-2 font-medium">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {bleDevices.map((d) => {
                // 🔒 Device column should always show the *raw* device name, not the nickname:
                const deviceLabel = d.rawName || "BLE Device";
                const nickname = d.nickname || "";

                return (
                  <tr key={d.mac} className="bg-white/60 hover:bg-white">
                    {/* Device column (raw name only) */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="inline-flex items-center justify-center rounded-xl bg-indigo-50 p-2 shrink-0">
                          <Bluetooth className="h-4 w-4 text-[#6B77F7]" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{deviceLabel}</div>
                          <div className="text-xs text-zinc-500 truncate">{d.mac}</div>
                        </div>
                      </div>
                    </td>

                    {/* RSSI */}
                    <td className="px-4 py-3">
                      {typeof d.rssi === "number" ? `${d.rssi} dBm` : "—"}
                    </td>

                    {/* Nickname — pill only here */}
                    <td className="px-4 py-3">
                      {nickname ? (
                        <span
                          className="inline-flex max-w-full items-center rounded-full text-xs font-medium truncate"
                          style={{
                            padding: "0.12rem 0.45rem",
                            background: tagPalette(nickname).bg,
                            border: `1px solid ${tagPalette(nickname).border}`,
                            color: tagPalette(nickname).text,
                            lineHeight: 1.15,
                          }}
                          title={nickname}
                        >
                          {nickname}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>

                    {/* Change Nickname */}
                    <td className="px-4 py-3">
                      <button
                        className="tsq-icon-btn"
                        title={`Set nickname for ${deviceLabel}`}
                        onClick={() => handleOpenAssign(d.mac, nickname || undefined)}
                        disabled={!selectedFamilyId}
                      >
                        <Edit3 className="h-4 w-4 text-zinc-600" />
                      </button>
                    </td>

                    {/* Action */}
                    <td className="px-4 py-3 text-right">
                      <button
                        className={`tsq-btn ${d.connected ? "ghost" : "primary"}`}
                        onClick={() => handleToggleConnect(d)}
                        disabled={!!d.connecting}
                      >
                        {d.connecting ? "Working…" : d.connected ? "Disconnect" : "Connect"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer hint (unchanged) */}
        
      </div>

      {/* Nickname Modal */}
      {nicknameModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={closeNicknameModal} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="font-medium">Assign Device & Nickname</div>
                <button className="tsq-icon-btn" onClick={closeNicknameModal} title="Close">
                  <X className="h-5 w-5 text-zinc-600" />
                </button>
              </div>

              <div className="px-4 py-4 space-y-3 text-sm">
                <div className="text-zinc-600">
                  Selected family:&nbsp;
                  <span className="font-medium text-zinc-800">
                    {selectedFamilyLabel || "—"}
                  </span>
                </div>
                <div>
                  <label className="tsq-field-label">Nickname</label>
                  <input
                    className="tsq-input"
                    placeholder="e.g., Gateway-Lab, Beacon-North, Unit-A"
                    value={nicknameDraft}
                    onChange={(e) => setNicknameDraft(e.target.value)}
                    autoFocus
                  />
                  <p className="mt-1 text-xs text-zinc-500">
                    Appears as a small colored tag in “Nickname”.
                  </p>
                </div>
              </div>

              <div className="px-4 py-3 border-t flex items-center justify-end gap-2">
                <button className="tsq-btn ghost" onClick={closeNicknameModal}>
                  Cancel
                </button>
                <button
                  className="tsq-btn primary"
                  disabled={!selectedFamilyId || !nicknameModalMac}
                  onClick={handleAssignSave}
                >
                  Save & Assign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
