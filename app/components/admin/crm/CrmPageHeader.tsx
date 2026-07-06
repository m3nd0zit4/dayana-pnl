import type { ReactNode } from "react";

type Props = {
  title: string;
  action?: ReactNode;
  trailing?: ReactNode;
};

const CrmPageHeader = ({ title, action, trailing }: Props) => (
  <header className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {action}
    </div>
    {trailing}
  </header>
);

export default CrmPageHeader;
