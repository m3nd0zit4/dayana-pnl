"use client";

import { FileText, ImageIcon } from "lucide-react";
import type { NotebookPageKind } from "@prisma/client";

type Props = {
  contactId: string;
  pageId: string;
  kind: NotebookPageKind;
  previewUrl: string | null;
  attachmentMime: string | null;
};

const NotebookPageThumbnail = ({
  contactId,
  pageId,
  kind,
  previewUrl,
  attachmentMime,
}: Props) => {
  const previewSrc = previewUrl
    ? `/api/admin/contacts/${contactId}/notebook/pages/${pageId}/attachment?type=preview`
    : null;

  if (previewSrc) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={previewSrc}
        alt=""
        className="crm-notebook-thumb-img"
        loading="lazy"
      />
    );
  }

  if (kind === "UPLOAD") {
    const isPdf = attachmentMime === "application/pdf";
    return (
      <div className="crm-notebook-thumb-placeholder">
        {isPdf ? (
          <FileText className="size-4 opacity-50" />
        ) : (
          <ImageIcon className="size-4 opacity-50" />
        )}
      </div>
    );
  }

  return <div className="crm-notebook-thumb-placeholder" />;
};

export default NotebookPageThumbnail;
