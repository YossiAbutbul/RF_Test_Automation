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
  devices: BleDevice[];   // visible, filtered
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
  analyzerConnect: () => void;
  analyzerDisconnect: () => void;
};

export type AppState = {
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
    // show if assigned to selected project
    if (d.assignedProject === familyId) return true;
    // or matches raw advertisement name
    const rn = (d.rawName ?? "").toLowerCase();
    return rn.includes(needle);
  });
}

function computeVisibleDevices(
  discovered: Record<string, BleDevice>,
  familyId: string
): BleDevice[] {
  // stable list; optionally sort by RSSI desc then nickname/rawName
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
  (import.meta as any).env?.VITE_API_BASE?.replace(/\/+$/, "") || "";
const SCAN_DURATION_MS = 20_000;

/* -------------------------------------------------------
   Store
------------------------------------------------------- */
export const useAppStore = create<AppState>()(
  devtools((set, get) => ({
    /* ---------------- Config ---------------- */
    config: {
      projectFamilies: [],
      selectedFamilyId: loadJSON(LS_FAMILY, ""),
    },

    /* ---------------- BLE ---------------- */
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

    /* ---------------- Analyzer ---------------- */
    analyzer: {
      ip: "172.16.10.1",
      port: "5555",
      model: "Keysight / R&S",
      connected: false,
    },

    /* ---------------- Actions ---------------- */
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

      setSelectedFamily(id: string) {
        saveJSON(LS_FAMILY, id);
        set((s) => ({
          config: { ...s.config, selectedFamilyId: id },
          ble: {
            ...s.ble,
            devices: computeVisibleDevices(s.ble.discovered, id),
          },
        }));
      },

      /* ------- SSE scan with batched flush to keep scrolling smooth ------- */
      bleScanStream() {
        if (activeSse) {
          try { activeSse.close(); } catch {}
          activeSse = null;
        }

        const deadline = Date.now() + SCAN_DURATION_MS;
        // NOTE: don't wipe nicknames/assignments; keep discovered clean slate for fresh list
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

        // Batch incoming events to avoid a re-render per packet
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

              // rawName: only accept truthy incoming name
              const nextRawName =
                (msg.name && String(msg.name).trim().length > 0)
                  ? msg.name
                  : prev.rawName ?? null;

              // rssi: accept numeric only; never overwrite with null/undefined
              const nextRssi =
                typeof msg.rssi === "number"
                  ? msg.rssi
                  : (typeof prev.rssi === "number" ? prev.rssi : null);

              disc[msg.mac] = {
                ...prev,
                rawName: nextRawName,
                rssi: nextRssi,
                // keep nickname & assignment
                nickname: prev.nickname ?? s.ble.nicknames[msg.mac] ?? null,
                assignedProject: prev.assignedProject ?? s.ble.assignments[msg.mac] ?? null,
              };
            }

            const nextVisible = computeVisibleDevices(
              disc,
              s.config.selectedFamilyId
            );

            return { ble: { ...s.ble, discovered: disc, devices: nextVisible } };
          });
        };

        const es = new EventSource(streamUrl);
        activeSse = es;

        es.onmessage = (ev) => {
          let raw: any;
          try { raw = JSON.parse(ev.data); } catch { return; }
          if (!raw || typeof raw !== "object" || !raw.mac) return;
          // queue minimal fields; backend sends {mac, name, rssi}
          pending.set(raw.mac, { mac: raw.mac, name: raw.name ?? null, rssi: raw.rssi });
          if (flushTimer == null) {
            flushTimer = window.setTimeout(flush, FLUSH_EVERY_MS) as unknown as number;
          }
        };

        es.addEventListener("done", () => {
          if (flushTimer != null) { window.clearTimeout(flushTimer); flushTimer = null; }
          flush();
          try { es.close(); } catch {}
          if (activeSse === es) activeSse = null;
          set((s) => ({ ble: { ...s.ble, scanning: false, scanEndsAt: null } }));
        });

        es.onerror = () => {
          // best-effort close & end scan
          if (flushTimer != null) { window.clearTimeout(flushTimer); flushTimer = null; }
          flush();
          try { es.close(); } catch {}
          if (activeSse === es) activeSse = null;
          set((s) => ({ ble: { ...s.ble, scanning: false, scanEndsAt: null } }));
        };

        // Hard-stop UI at deadline (guard)
        window.setTimeout(() => {
          if (activeSse === es) {
            try { es.close(); } catch {}
            activeSse = null;
            if (flushTimer != null) { window.clearTimeout(flushTimer); flushTimer = null; }
            flush();
            set((s) => ({ ble: { ...s.ble, scanning: false, scanEndsAt: null } }));
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

      /* -------- Assign selected project (by family id) -------- */
      bleAssign(mac, familyId) {
        set((s) => {
          const assignments = { ...s.ble.assignments, [mac]: familyId };
          saveJSON(LS_ASSIGN, assignments);

          const prev = s.ble.discovered[mac] || { mac } as BleDevice;
          const updated = { ...prev, assignedProject: familyId };

          const discovered = { ...s.ble.discovered, [mac]: updated };
          const devices = s.ble.devices.map((d) => (d.mac === mac ? updated : d));

          return { ble: { ...s.ble, assignments, discovered, devices } };
        });
      },

      /* -------- Nickname modal flow -------- */
      openNicknameModal(mac, initialDraft) {
        set((s) => ({
          ble: {
            ...s.ble,
            nicknameModalOpen: true,
            nicknameModalMac: mac,
            nicknameDraft: initialDraft ?? s.ble.nicknames[mac] ?? "",
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
          const nicknames = { ...s.ble.nicknames, [mac]: nickname };
          saveJSON(LS_NICK, nicknames);

          // update discovered & devices without altering rawName
          const prev = s.ble.discovered[mac] || { mac } as BleDevice;
          const updated = { ...prev, nickname };

          const discovered = { ...s.ble.discovered, [mac]: updated };
          const devices = s.ble.devices.map((d) => (d.mac === mac ? updated : d));

          return {
            ble: {
              ...s.ble,
              nicknames,
              discovered,
              devices,
              nicknameModalOpen: false,
              nicknameModalMac: null,
              nicknameDraft: "",
            },
          };
        });
      },

      /* -------- Connect / Disconnect -------- */
      async bleConnect(mac) {
        set((s) => ({
          ble: {
            ...s.ble,
            discovered: {
              ...s.ble.discovered,
              [mac]: {
                ...(s.ble.discovered[mac] || { mac }),
                connecting: true,
              },
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
        set((s) => ({
          ble: {
            ...s.ble,
            discovered: {
              ...s.ble.discovered,
              [mac]: {
                ...(s.ble.discovered[mac] || { mac }),
                connecting: true,
              },
            },
            devices: s.ble.devices.map((d) =>
              d.mac === mac ? { ...d, connecting: true } : d
            ),
          },
        }));
        try {
          await fetch(`${API_BASE}/api/ble/disconnect`, {
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
                  connected: false,
                },
              },
              devices: s.ble.devices.map((d) =>
                d.mac === mac ? { ...d, connected: false } : d
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

      analyzerConnect() {
        set((s) => ({ analyzer: { ...s.analyzer, connected: true } }));
      },
      analyzerDisconnect() {
        set((s) => ({ analyzer: { ...s.analyzer, connected: false } }));
      },
    },
  }))
);
