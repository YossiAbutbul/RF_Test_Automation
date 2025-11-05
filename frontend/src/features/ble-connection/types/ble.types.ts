// frontend/src/features/ble-connection/types/ble.types.ts

export interface BleDevice {
  mac: string;
  rawName?: string | null;
  nickname?: string | null;
  rssi?: number | null;
  assignedProject?: string | null;
  connecting?: boolean;
  connected?: boolean;
}

export interface ProjectFamily {
  id: string;
  label: string;
}

export interface ColorPalette {
  bg: string;
  border: string;
  text: string;
}