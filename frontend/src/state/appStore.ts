import { create } from "zustand";
import { devtools } from "zustand/middleware";

/* -------------------------------------------------------
   Local persistence helpers
------------------------------------------------------- */
const LS_ASSIGN = "rf:ble:assignments";
const LS_NICK   = "rf:ble:nicknames";
const LS_FAMILY = "rf:selectedFamily";

function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON<T>(key: string, val: T) {
  try {
    localStorage.setItem(key, JSON.stringify(val));
  } catch { /* ignore */ }
}

/* -------------------------------------------------------
   Types
------------------------------------------------------- */
export type ProjectFamily = { id: string; label: string };

export type BleDevice = {
  mac: string;
  /** Raw advertisement name from scanner (never overwritten by nickname) */
  rawName?: string | null;
  /** User nickname (what you enter in Assign dialog) */
  nickname?: string | null;
  rssi?: number | null;
  assignedProject?: string | null;
  connecting?: boolean;
  connected?: boolean;
};

type ConfigSlice = {
  projectFamilies: ProjectFamily[];
  selectedFamilyId: string;
};

type BleSlice = {
  devices: BleDevice[];
  scanning: boolean;
  scanEndsAt: number | null;
  discovered: Record<string, BleDevice>;
  assignments: Record<string, string>;
  nicknames: Record<string, string>;
  nicknameModalOpen: boolean;
  nicknameModalMac: string | null;
  nicknameDraft: string;
};

type AnalyzerSlice = {
  ip: string;
  port: string;
  model?: string;
  connected: boolean;
};

type Actions = {
  loadProjectFamilies: () => Promise<void>;
  setSelectedFamily: (id: string) => void;
  bleScanStream: () => void;
  cancelBleScan: () => void;
  bleAssign: (mac: string, familyId: string) => void;
  openNicknameModal: (mac: string, initialDraft?: string) => void;
  closeNicknameModal: () => void;
  setNicknameDraft: (v: string) => void;
  saveNickname: (mac: string, nickname: string) => void;
  bleConnect: (mac: string) => Promise<void>;
  bleDisconnect: (mac: string) => Promise<void>;

  /* analyzer setters used by AnalyzerConnection.tsx */
  setAnalyzerState: (patch: Partial<AnalyzerSlice>) => void;
  setAnalyzerIp: (ip: string) => void;
  setAnalyzerPort: (port: string) => void;
  setAnalyzerModel: (model: string) => void;

  analyzerConnect: () => void;
  analyzerDisconnect: () => void;
};

type RootState = {
  config: ConfigSlice;
  ble: BleSlice;
  analyzer: AnalyzerSlice;
  actions: Actions;
};

/* -------------------------------------------------------
   Globals
------------------------------------------------------- */
let activeSse: EventSource | null = null;

/* -------------------------------------------------------
   Helpers
------------------------------------------------------- */
function filterByFamily(
  devices: BleDevice[],
  familyId: string
): BleDevice[] {
  if (!familyId || familyId === "ALL") return devices;

  const needle = familyId.toLowerCase();
  return devices.filter((d) => {
    if (d.assignedProject === familyId) return true;
    const rn = (d.rawName ?? "").toLowerCase();
    return rn.includes(needle);
  });
}

function computeVisibleDevices(
  discovered: Record<string, BleDevice>,
  familyId: string
): BleDevice[] {
  const list = Object.values(discovered).sort((a, b) => {
    const ra = typeof a.rssi === "number" ? a.rssi : -9999;
    const rb = typeof b.rssi === "number" ? b.rssi : -9999;
    if (rb !== ra) return rb - ra;
    const na = (a.nickname || a.rawName || "").toLowerCase();
    const nb = (b.nickname || b.rawName || "").toLowerCase();
    return na.localeCompare(nb);
  });
  return filterByFamily(list, familyId);
}

const API_BASE =
  (import.meta as any)?.env?.VITE_API_BASE?.trim() || "http://127.0.0.1:8000";

/* -------------------------------------------------------
   Store
------------------------------------------------------- */
export const useAppStore = create<RootState>()(
  devtools((set, get) => ({
    config: {
      projectFamilies: [],
      selectedFamilyId: "ALL",
    },

    ble: {
      devices: [],
      scanning: false,
      scanEndsAt: null,
      discovered: {},
      assignments: loadJSON<Record<string, string>>(LS_ASSIGN, {}),
      nicknames: loadJSON<Record<string, string>>(LS_NICK, {}),
      nicknameModalOpen: false,
      nicknameModalMac: null,
      nicknameDraft: "",
    },

    analyzer: {
      ip: "172.16.10.1",
      port: "5555",
      model: "",
      connected: false,
    },

    actions: {
      async loadProjectFamilies() {
        const list: ProjectFamily[] = [
          { id: "ALL",       label: "All devices" },
          { id: "sonata2US", label: "sonata2US" },
          { id: "CATM2",     label: "CATM2" },
        ];
        set((s) => ({
          config: {
            ...s.config,
            projectFamilies: list,
            selectedFamilyId: s.config.selectedFamilyId || list[0].id,
          },
        }));
      },

      setSelectedFamily(id) {
        set((s) => ({
          config: {
            ...s.config,
            selectedFamilyId: id,
          },
          ble: {
            ...s.ble,
            devices: computeVisibleDevices(s.ble.discovered, id),
          },
        }));
      },

      /* -------- BLE scan stream (SSE) -------- */
      bleScanStream() {
        const SCAN_DURATION_MS = 10000;
        const deadline = Date.now() + SCAN_DURATION_MS;
        if (activeSse) {
          try { activeSse.close(); } catch {}
          activeSse = null;
        }
        set((s) => ({
          ble: {
            ...s.ble,
            scanning: true,
            scanEndsAt: deadline,
            discovered: {},
            devices: [],
          },
        }));

        const streamUrl = `${API_BASE}/api/ble/scan/stream?duration=${Math.floor(
          SCAN_DURATION_MS / 1000
        )}`;

        const pending = new Map<string, { mac: string; name?: string | null; rssi?: number | null }>();
        let flushTimer: number | null = null;
        const FLUSH_EVERY_MS = 120;

        const flush = () => {
          if (pending.size === 0) { flushTimer = null; return; }
          const updates = Array.from(pending.values());
          pending.clear();
          flushTimer = null;

          set((s) => {
            const disc = { ...s.ble.discovered };
            for (const msg of updates) {
              const prev = disc[msg.mac] || { mac: msg.mac } as BleDevice;

              const nextName =
                msg.name != null && String(msg.name).trim() !== ""
                  ? String(msg.name)
                  : prev.rawName ?? null;

              disc[msg.mac] = {
                ...prev,
                rawName: nextName,
                rssi: typeof msg.rssi === "number" ? msg.rssi : prev.rssi ?? null,
                assignedProject: prev.assignedProject ?? s.ble.assignments[msg.mac] ?? null,
                nickname: s.ble.nicknames[msg.mac] ?? prev.nickname ?? null,
              };
            }

            const vis = computeVisibleDevices(disc, s.config.selectedFamilyId);

            return {
              ble: {
                ...s.ble,
                discovered: disc,
                devices: vis,
              },
            };
          });
        };

        const es = new EventSource(streamUrl);
        activeSse = es;

        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            const mac  = data?.mac;
            if (!mac) return;
            const name = data?.name ?? null;
            const rssi = typeof data?.rssi === "number" ? data.rssi : null;
            pending.set(mac, { mac, name, rssi });

            if (flushTimer == null) {
              flushTimer = window.setTimeout(flush, FLUSH_EVERY_MS);
            }
          } catch {
            // ignore malformed
          }
        };

        es.onerror = () => {
          try { es.close(); } catch {}
          if (activeSse === es) activeSse = null;
          if (flushTimer != null) { window.clearTimeout(flushTimer); flushTimer = null; }
          flush();
          set((s) => ({ ble: { ...s.ble, scanning: false, scanEndsAt: null } }));
        };

        window.setTimeout(() => {
          if (activeSse === es) {
            try { es.close(); } catch {}
            activeSse = null;
            if (flushTimer != null) { window.clearTimeout(flushTimer); flushTimer = null; }
            flush();
            set((s) => ({ 
              ble: { ...s.ble, scanning: false, scanEndsAt: null } 
            }));
          }
        }, SCAN_DURATION_MS + 300);
      },

      cancelBleScan() {
        if (activeSse) {
          try { activeSse.close(); } catch {}
          activeSse = null;
        }
        set((s) => ({ ble: { ...s.ble, scanning: false, scanEndsAt: null } }));
      },

      /* -------- Assign selected project -------- */
      bleAssign(mac, familyId) {
        set((s) => {
          const nextAssignments = { ...s.ble.assignments, [mac]: familyId };
          saveJSON(LS_ASSIGN, nextAssignments);

          const disc = { ...s.ble.discovered };
          if (disc[mac]) disc[mac] = { ...disc[mac], assignedProject: familyId };

          const devices = s.ble.devices.map((d) =>
            d.mac === mac ? { ...d, assignedProject: familyId } : d
          );

          return {
            ble: {
              ...s.ble,
              assignments: nextAssignments,
              discovered: disc,
              devices,
            },
          };
        });
      },

      openNicknameModal(mac, initialDraft) {
        set((s) => ({
          ble: {
            ...s.ble,
            nicknameModalOpen: true,
            nicknameModalMac: mac,
            nicknameDraft:
              initialDraft ??
              s.ble.nicknames[mac] ??
              s.ble.discovered[mac]?.nickname ??
              s.ble.discovered[mac]?.rawName ??
              "",
          },
        }));
      },
      closeNicknameModal() {
        set((s) => ({
          ble: {
            ...s.ble,
            nicknameModalOpen: false,
            nicknameModalMac: null,
            nicknameDraft: "",
          },
        }));
      },
      setNicknameDraft(v) {
        set((s) => ({ ble: { ...s.ble, nicknameDraft: v } }));
      },
      saveNickname(mac, nickname) {
        set((s) => {
          const next = { ...s.ble.nicknames, [mac]: nickname };
          saveJSON(LS_NICK, next);

          const disc = { ...s.ble.discovered };
          if (disc[mac]) disc[mac] = { ...disc[mac], nickname };

          const devices = s.ble.devices.map((d) =>
            d.mac === mac ? { ...d, nickname } : d
          );

          return {
            ble: {
              ...s.ble,
              nicknames: next,
              discovered: disc,
              devices,
              nicknameModalOpen: false,
              nicknameModalMac: null,
              nicknameDraft: "",
            },
          };
        });
      },

      async bleConnect(mac) {
        set((s) => ({
          ble: {
            ...s.ble,
            discovered: {
              ...s.ble.discovered,
              [mac]: { ...(s.ble.discovered[mac] || { mac }), connecting: true },
            },
            devices: s.ble.devices.map((d) =>
              d.mac === mac ? { ...d, connecting: true } : d
            ),
          },
        }));
        try {
          await fetch(`${API_BASE}/api/ble/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac }),
          }).catch(() => {});
          set((s) => ({
            ble: {
              ...s.ble,
              discovered: {
                ...s.ble.discovered,
                [mac]: {
                  ...(s.ble.discovered[mac] || { mac }),
                  connected: true,
                },
              },
              devices: s.ble.devices.map((d) =>
                d.mac === mac ? { ...d, connected: true } : d
              ),
            },
          }));
        } finally {
          set((s) => ({
            ble: {
              ...s.ble,
              discovered: {
                ...s.ble.discovered,
                [mac]: {
                  ...(s.ble.discovered[mac] || { mac }),
                  connecting: false,
                },
              },
              devices: s.ble.devices.map((d) =>
                d.mac === mac ? { ...d, connecting: false } : d
              ),
            },
          }));
        }
      },

      async bleDisconnect(mac) {
        try {
          await fetch(`${API_BASE}/api/ble/disconnect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mac }),
          }).catch(() => {});
        } finally {
          set((s) => ({
            ble: {
              ...s.ble,
              discovered: {
                ...s.ble.discovered,
                [mac]: {
                  ...(s.ble.discovered[mac] || { mac }),
                  connected: false,
                },
              },
              devices: s.ble.devices.map((d) =>
                d.mac === mac ? { ...d, connected: false } : d
              ),
            },
          }));
        }
      },

      /* analyzer setters used by AnalyzerConnection.tsx */
      setAnalyzerState(patch) {
        set((s) => ({ analyzer: { ...s.analyzer, ...patch } }));
      },
      setAnalyzerIp(ip) {
        set((s) => ({ analyzer: { ...s.analyzer, ip } }));
      },
      setAnalyzerPort(port) {
        set((s) => ({ analyzer: { ...s.analyzer, port } }));
      },
      setAnalyzerModel(model) {
        set((s) => ({ analyzer: { ...s.analyzer, model } }));
      },

      analyzerConnect() {
        set((s) => ({ analyzer: { ...s.analyzer, connected: true } }));
      },
      analyzerDisconnect() {
        set((s) => ({ analyzer: { ...s.analyzer, connected: false } }));
      },
    },
  }))
);
