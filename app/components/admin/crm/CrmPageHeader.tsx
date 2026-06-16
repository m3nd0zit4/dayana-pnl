import type { ReactNode } from "react";

type Props = {
  title: string;
  action?: ReactNode;
  trailing?: ReactNode;
};

const CrmPageHeader = ({ title, action, trailing }: Props) => (
  <header className="crm-page-header">
    <div className="crm-page-header-main">
      <h1 className="crm-page-title">{title}</h1>
      {action ? <div className="crm-page-header-action">{action}</div> : null}
    </div>
    {trailing ? <div className="crm-page-header-trailing">{trailing}</div> : null}
  </header>
);

export default CrmPageHeader;
