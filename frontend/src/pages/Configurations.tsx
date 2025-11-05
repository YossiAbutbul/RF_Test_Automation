// frontend/src/pages/Configurations.tsx
import { PageHeader, Card } from "@/shared/components/ui";
import { BleScanner } from "@/features/ble-connection/components";
import { AnalyzerConnection } from "@/features/analyzer-connection/components";
import "./css/Configurations.css";

export default function Configurations() {
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
        <AnalyzerConnection />
      </div>
    </div>
  );
}