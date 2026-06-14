import type { NotebookPageBackground } from "@prisma/client";

type Props = {
  background: NotebookPageBackground;
};

const NotebookBackground = ({ background }: Props) => {
  if (background === "BLANK") return null;

  const className =
    background === "RULED"
      ? "crm-notebook-bg-ruled"
      : "crm-notebook-bg-grid";

  return <div className={className} aria-hidden />;
};

export default NotebookBackground;
