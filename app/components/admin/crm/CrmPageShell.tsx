import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
};

const CrmPageShell = ({ children, className = "" }: Props) => (
  <div className={`crm-page-shell ${className}`.trim()}>{children}</div>
);

export default CrmPageShell;
