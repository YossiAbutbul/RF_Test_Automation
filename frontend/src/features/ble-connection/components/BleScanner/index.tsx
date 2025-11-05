// frontend/src/features/ble-connection/components/BleScanner/index.tsx

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/shared/components/ui/Card";
import { useAppStore } from "@/state/appStore";
import type { ProjectFamily, BleDevice } from "../../types/ble.types";

import ScanControls from "./ScanControls";
import DeviceTable from "./DeviceTable";
import NicknameModal from "./NicknameModal";

export default function BleScanner() {
  // Store selectors
  const projectFamilies = useAppStore((s) => s.config.projectFamilies) as ProjectFamily[];
  const selectedFamilyId = useAppStore((s) => s.config.selectedFamilyId) as string;
  const bleDevices = useAppStore((s) => s.ble.devices) as BleDevice[];
  const scanning = useAppStore((s) => s.ble.scanning);
  const scanEndsAt = useAppStore((s) => s.ble.scanEndsAt);
  const nicknameModalOpen = useAppStore((s) => s.ble.nicknameModalOpen);
  const nicknameModalMac = useAppStore((s) => s.ble.nicknameModalMac);
  const nicknameDraft = useAppStore((s) => s.ble.nicknameDraft);

  // Actions
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

  // Load project families on mount
  useEffect(() => {
    loadProjectFamilies();
  }, [loadProjectFamilies]);

  // Selected family label
  const selectedFamilyLabel = useMemo(
    () => projectFamilies.find((f) => f.id === selectedFamilyId)?.label ?? "",
    [projectFamilies, selectedFamilyId]
  );

  // Scan countdown timer
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

  // Handlers
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
    if (d.connected) {
      await bleDisconnect(d.mac);
    } else {
      await bleConnect(d.mac);
    }
  };

  return (
    <>
      <Card className="dut-connection-card lg:col-span-2 p-0">
        {/* Fixed controls area */}
        <div className="controls">
          <div className="text-base font-medium">DUT Connection</div>
          <div className="text-sm text-zinc-500">Connect to Device Under Test</div>

          <ScanControls
            projectFamilies={projectFamilies}
            selectedFamilyId={selectedFamilyId}
            scanning={scanning}
            scanSecondsLeft={scanSecondsLeft}
            onFamilyChange={setSelectedFamily}
            onScan={handleScan}
            onCancel={handleCancel}
          />
        </div>

        {/* Scrollable device table */}
        <DeviceTable
          devices={bleDevices}
          selectedFamilyLabel={selectedFamilyLabel}
          onOpenAssign={handleOpenAssign}
          onToggleConnect={handleToggleConnect}
        />
      </Card>

      {/* Nickname Modal */}
      <NicknameModal
        isOpen={nicknameModalOpen}
        nickname={nicknameDraft}
        onNicknameChange={setNicknameDraft}
        onSave={handleAssignSave}
        onClose={closeNicknameModal}
      />
    </>
  );
}