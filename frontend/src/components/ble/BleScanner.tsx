import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Bluetooth, Plus, Pencil, Edit3, RefreshCcw, X, PlugZap, Plug, StopCircle } from "lucide-react";
import { useAppStore } from "@/state/appStore";
import type { ProjectFamily, BleDevice } from "@/state/appStore";

// Deterministic color for nickname tag
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
  // ------------ Selectors ------------
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

  // Countdown UI for scan (purely visual)
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
            <label className="text-xs text-zinc-500">Project family</label>
            <select
              className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
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
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border hover:bg-zinc-50 disabled:opacity-60"
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
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white border hover:bg-zinc-50"
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
          {/* Fixed layout + colgroup: Nickname auto-fills remaining width */}
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
                {scanning && bleDevices.length === 0 && (
                    <>
                    {Array.from({ length: 3 }).map((_, i) => (
                        <tr key={`skeleton-${i}`} className="bg-white/60 animate-pulse">
                        {/* Device */}
                        <td className="px-4 py-3">
                            <div className="flex items-center gap-3">
                            <div className="inline-flex items-center justify-center rounded-xl bg-indigo-50 p-2 shrink-0">
                                <Bluetooth className="h-4 w-4 text-[#6B77F7]" />
                            </div>
                            <div className="space-y-2 w-full">
                                <div className="h-3 w-3/4 rounded bg-zinc-200" />
                                <div className="h-2 w-1/2 rounded bg-zinc-100" />
                            </div>
                            </div>
                        </td>

                        {/* RSSI */}
                        <td className="px-4 py-3">
                            <div className="h-3 w-10 rounded bg-zinc-200 mx-auto" />
                        </td>

                        {/* Nickname */}
                        <td className="px-4 py-3">
                            <div className="h-3 w-3/5 rounded bg-zinc-200 mx-auto" />
                        </td>

                        {/* Edit nickname */}
                        <td className="px-4 py-3">
                            <div className="h-6 w-6 rounded-full bg-zinc-200 mx-auto" />
                        </td>

                        {/* Connect/Disconnect */}
                        <td className="px-4 py-3">
                            <div className="ml-auto h-8 w-24 rounded-lg bg-zinc-200" />
                        </td>
                        </tr>
                    ))}
                    </>
                )}

              {!scanning && (!bleDevices || bleDevices.length === 0) && (
                <tr>
                  <td className="px-4 py-6 text-center text-zinc-500" colSpan={5}>
                    {selectedFamilyId
                      ? "No devices found for this project family. Try scanning."
                      : "Select a project family and scan for devices."}
                  </td>
                </tr>
              )}

              {bleDevices.map((d) => {
                const displayName = d.nickname || d.rawName || "BLE Device";
                return (
                  <tr key={d.mac} className="bg-white/60 hover:bg-white">
                    {/* Device column */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="inline-flex items-center justify-center rounded-xl bg-indigo-50 p-2 shrink-0">
                          <Bluetooth className="h-4 w-4 text-[#6B77F7]" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium truncate">{displayName}</div>
                          <div className="text-xs text-zinc-500 truncate">{d.mac}</div>
                        </div>
                      </div>
                    </td>

                    {/* RSSI */}
                    <td className="px-4 py-3">
                      {typeof d.rssi === "number" ? `${d.rssi} dBm` : "—"}
                    </td>

                    {/* Nickname: widest column, truncates nicely */}
                    <td className="px-4 py-3">
                      {d.nickname ? (
                        <span
                          className="inline-flex max-w-full items-center rounded-full text-xs font-medium truncate"
                          style={{
                            padding: "0.12rem 0.45rem",
                            background: tagPalette(d.nickname).bg,
                            border: `1px solid ${tagPalette(d.nickname).border}`,
                            color: tagPalette(d.nickname).text,
                            lineHeight: 1.15,
                          }}
                          title={d.nickname}
                        >
                          {d.nickname}
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400">—</span>
                      )}
                    </td>

                    {/* Change Nickname: just the + button */}
                    <td className="px-4 py-3">
                      <button
                        className="inline-flex items-center justify-center p-2 rounded-lg hover:bg-zinc-100 transition-colors"
                        title={`Set nickname for ${displayName}`}
                        onClick={() => handleOpenAssign(d.mac, d.nickname ?? undefined)}
                        disabled={!selectedFamilyId}
                      >
                        <Edit3 className="h-4 w-4 text-zinc-600" />
                      </button>
                    </td>

                    {/* Action: Connect / Disconnect */}
                    <td className="px-4 py-3">
                      <div className="flex justify-start">
                        <button
                          className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-white disabled:opacity-60 ${
                            d.connected ? "bg-rose-500 hover:opacity-95" : "bg-[#6B77F7] hover:opacity-95"
                          }`}
                          onClick={() => handleToggleConnect(d)}
                          disabled={!!d.connecting}
                        >
                          {d.connecting ? (
                            <>
                              <RefreshCcw className="h-4 w-4 animate-spin" />
                              {d.connected ? "Disconnecting…" : "Connecting…"}
                            </>
                          ) : d.connected ? (
                            <>
                              {/* <Plug className="h-4 w-4" /> */}
                              Disconnect
                            </>
                          ) : (
                            <>
                              {/* <PlugZap className="h-4 w-4" /> */}
                              Connect
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer hint */}
        <div className="flex items-center justify-between mt-4 px-4 pb-4 text-sm">
          <div className="text-rose-600 inline-flex items-center gap-2">
            <span className="text-lg">●</span> Disconnected
          </div>
          <div className="text-xs text-zinc-500">
            Assign a nickname to identify the device quickly.
          </div>
        </div>
      </div>

      {/* Nickname Modal */}
      {nicknameModalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={closeNicknameModal} />
          <div className="absolute inset-0 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-xl border">
              <div className="flex items-center justify-between px-4 py-3 border-b">
                <div className="font-medium">Assign Device & Nickname</div>
                <button className="p-1 rounded-lg hover:bg-zinc-100" onClick={closeNicknameModal}>
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
                  <label className="text-xs text-zinc-500">Nickname</label>
                  <input
                    className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
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
                <button className="px-3 py-2 rounded-xl border bg-white hover:bg-zinc-50" onClick={closeNicknameModal}>
                  Cancel
                </button>
                <button
                  className="px-3 py-2 rounded-xl text-white bg-[#6B77F7] hover:opacity-95 disabled:opacity-50"
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
