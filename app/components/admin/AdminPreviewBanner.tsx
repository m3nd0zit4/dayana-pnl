import { Alert, AlertDescription } from "@/app/components/ui/alert";

const AdminPreviewBanner = () => (
  <Alert
    role="status"
    className="border-accent/50 bg-gradient-to-r from-secondary/50 to-accent/35 text-primary"
  >
    <AlertDescription className="text-primary">
      <strong className="font-semibold">Vista previa local</strong>
      <p className="mt-1">
        <code>CRM_UI_PREVIEW=true</code> — sin login ni base de datos. Configura{" "}
        <code>DATABASE_URL</code>, <code>AUTH_SECRET</code> y{" "}
        <code>npm run db:seed</code> para el CRM real.
      </p>
    </AlertDescription>
  </Alert>
);

export default AdminPreviewBanner;
