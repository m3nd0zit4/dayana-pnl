const AdminPreviewBanner = () => (
  <div role="status" className="crm-alert-preview">
    <strong className="font-semibold">Vista previa local</strong>
    <p className="mt-1">
      <code>CRM_UI_PREVIEW=true</code> — sin login ni base de datos. Configura{" "}
      <code>DATABASE_URL</code>, <code>AUTH_SECRET</code> y{" "}
      <code>npm run db:seed</code> para el CRM real.
    </p>
  </div>
);

export default AdminPreviewBanner;
