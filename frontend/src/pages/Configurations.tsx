import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import BleScanner from "@/components/ble/BleScanner";
import { useAppStore } from "@/state/appStore";
import "./css/Configurations.css";

export default function Configurations() {
  const analyzer = useAppStore((s) => s.analyzer);
  const analyzerConnect = useAppStore((s) => s.actions.analyzerConnect);
  const analyzerDisconnect = useAppStore((s) => s.actions.analyzerDisconnect);

  const anIp = analyzer.ip;
  const anPort = analyzer.port;
  const anModel = analyzer.model ?? "Spectrum Analyzer";
  const anConnected = analyzer.connected;

  return (
    <div className="configurations-page">
      <PageHeader
        title="Configurations"
        subtitle="Manage your test parameters and device settings"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* DUT / BLE Scanner (left, spans 2 columns) */}
        <BleScanner />

        {/* Analyzer Connection (right column) */}
        <Card className="p-4">
          <div className="text-base font-medium">Analyzer Connection</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-sm">
            <div>
              <label className="text-xs text-zinc-500">IP Address</label>
              <input
                className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                defaultValue={anIp}
                readOnly
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Port</label>
              <input
                className="w-full mt-1 rounded-xl border px-3 py-2 bg-white"
                defaultValue={anPort}
                readOnly
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500">Model</label>
              <div className="w-full mt-1 rounded-xl border px-3 py-2 bg-white">
                {anModel}
              </div>
            </div>
            <div>
              <label className="text-xs text-zinc-500">Status</label>
              <div className="mt-1">
                <span
                  className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full font-medium ${
                    anConnected ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"
                  }`}
                >
                  {anConnected ? "Connected" : "Disconnected"}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            {anConnected ? (
              <button
                className="px-3 py-2 rounded-xl bg-rose-500 text-white"
                onClick={analyzerDisconnect}
              >
                Disconnect
              </button>
            ) : (
              <button
                className="px-3 py-2 rounded-xl bg-emerald-500 text-white"
                onClick={analyzerConnect}
              >
                Connect
              </button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
