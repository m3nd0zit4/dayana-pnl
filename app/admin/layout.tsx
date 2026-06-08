import { SessionProvider } from "next-auth/react";
import "./crm.css";

const AdminLayout = ({ children }: { children: React.ReactNode }) => (
  <SessionProvider>
    <div className="crm-app">{children}</div>
  </SessionProvider>
);

export default AdminLayout;
