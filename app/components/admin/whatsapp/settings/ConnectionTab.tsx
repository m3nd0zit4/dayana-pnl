"use client";

import WhatsAppProviderCard, {
  type WhatsAppProviderSummaryDto,
} from "../../crm/settings/WhatsAppProviderCard";
import HistoryImportCard from "../HistoryImportCard";
import InboxHealthCard from "../InboxHealthCard";
import { SettingAnchor } from "./SettingRow";

/** Pestaña «Conexión»: por dónde entran los mensajes y si llegan todos. */
const ConnectionTab = ({ provider }: { provider: WhatsAppProviderSummaryDto | null }) => (
  <div className="space-y-6">
    <SettingAnchor id="wa-provider">
      {provider ? (
        <WhatsAppProviderCard initial={provider} />
      ) : (
        <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
          Vista previa: la conexión con WhatsApp se ve con la base de datos real.
        </p>
      )}
    </SettingAnchor>
    <SettingAnchor id="wa-inbox-health">
      <InboxHealthCard />
    </SettingAnchor>
    <SettingAnchor id="wa-history-import">
      <HistoryImportCard />
    </SettingAnchor>
  </div>
);

export default ConnectionTab;
