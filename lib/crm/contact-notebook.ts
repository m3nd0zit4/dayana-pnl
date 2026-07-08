import {
  NotebookPageBackground,
  NotebookPageKind,
  Prisma,
} from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "../db";
import { isBlobConfigured } from "../storage/blob";
import {
  loadCanvasSceneFromBlob,
  saveCanvasSceneToBlob,
} from "./notebook-canvas-blob";

export const MAX_NOTEBOOK_PAGES_PER_CONTACT = 200;
export const MAX_CANVAS_JSON_BYTES = 2 * 1024 * 1024;

const pageListSelect = {
  id: true,
  contactId: true,
  title: true,
  sortOrder: true,
  kind: true,
  background: true,
  canvasUrl: true,
  bodyText: true,
  attachmentUrl: true,
  attachmentMime: true,
  attachmentName: true,
  previewUrl: true,
  therapySessionId: true,
  enrollmentId: true,
  createdByStaffId: true,
  createdAt: true,
  updatedAt: true,
  therapySession: { select: { sessionNumber: true } },
  enrollment: { select: { product: { select: { title: true } } } },
} satisfies Prisma.ContactNotebookPageSelect;

const pageDetailSelect = {
  ...pageListSelect,
  canvasData: true,
} satisfies Prisma.ContactNotebookPageSelect;

export type NotebookPageListItem = {
  id: string;
  contactId: string;
  title: string;
  sortOrder: number;
  kind: NotebookPageKind;
  background: NotebookPageBackground;
  canvasUrl: string | null;
  bodyText: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  attachmentName: string | null;
  previewUrl: string | null;
  therapySessionId: string | null;
  enrollmentId: string | null;
  createdByStaffId: string | null;
  createdAt: string;
  updatedAt: string;
  sessionNumber: number | null;
  productTitle: string | null;
};

export type NotebookPageDetail = NotebookPageListItem & {
  canvasData: unknown;
};

type PageRow = Prisma.ContactNotebookPageGetPayload<{
  select: typeof pageListSelect;
}>;

type PageDetailRow = Prisma.ContactNotebookPageGetPayload<{
  select: typeof pageDetailSelect;
}>;

const mapListItem = (p: PageRow): NotebookPageListItem => ({
  id: p.id,
  contactId: p.contactId,
  title: p.title,
  sortOrder: p.sortOrder,
  kind: p.kind,
  background: p.background,
  canvasUrl: p.canvasUrl,
  bodyText: p.bodyText,
  attachmentUrl: p.attachmentUrl,
  attachmentMime: p.attachmentMime,
  attachmentName: p.attachmentName,
  previewUrl: p.previewUrl,
  therapySessionId: p.therapySessionId,
  enrollmentId: p.enrollmentId,
  createdByStaffId: p.createdByStaffId,
  createdAt: p.createdAt.toISOString(),
  updatedAt: p.updatedAt.toISOString(),
  sessionNumber: p.therapySession?.sessionNumber ?? null,
  productTitle: p.enrollment?.product.title ?? null,
});

// DB column wins when present: a Blob-outage fallback save writes the newer
// scene there while an older canvasUrl may still point at a stale blob.
const resolveDetail = async (p: PageDetailRow): Promise<NotebookPageDetail> => {
  let canvasData: unknown = p.canvasData ?? null;
  if (canvasData == null && p.canvasUrl) {
    canvasData = await loadCanvasSceneFromBlob(p.canvasUrl);
  }
  return { ...mapListItem(p), canvasData };
};

const deleteBlobUrls = async (urls: (string | null | undefined)[]) => {
  for (const url of urls) {
    if (!url) continue;
    try {
      await del(url);
    } catch {
      /* blob may already be gone */
    }
  }
};


const resolveSessionContext = async (
  contactId: string,
  therapySessionId?: string | null
) => {
  if (!therapySessionId) return { therapySessionId: null, enrollmentId: null };
  const session = await prisma.therapySession.findFirst({
    where: {
      id: therapySessionId,
      therapyPackage: { enrollment: { contactId } },
    },
    select: {
      id: true,
      therapyPackage: { select: { enrollmentId: true } },
    },
  });
  if (!session) return { therapySessionId: null, enrollmentId: null };
  return {
    therapySessionId: session.id,
    enrollmentId: session.therapyPackage.enrollmentId,
  };
};

export const listNotebookPages = async (contactId: string) => {
  const page = await prisma.contactNotebookPage.findFirst({
    where: { contactId, kind: NotebookPageKind.CANVAS },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: pageListSelect,
  });
  return page ? [mapListItem(page)] : [];
};

/** Keep one CANVAS page per contact; remove legacy extras (oldest wins). */
export const consolidateContactCanvasPages = async (contactId: string) => {
  const pages = await prisma.contactNotebookPage.findMany({
    where: { contactId, kind: NotebookPageKind.CANVAS },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      previewUrl: true,
      attachmentUrl: true,
      canvasUrl: true,
    },
  });

  if (pages.length <= 1) return pages[0]?.id ?? null;

  const [keep, ...remove] = pages;
  for (const page of remove) {
    await prisma.contactNotebookPage.delete({ where: { id: page.id } });
    await deleteBlobUrls([page.previewUrl, page.attachmentUrl, page.canvasUrl]);
  }

  const uploadPages = await prisma.contactNotebookPage.findMany({
    where: { contactId, kind: NotebookPageKind.UPLOAD },
    select: { id: true, previewUrl: true, attachmentUrl: true, canvasUrl: true },
  });
  for (const page of uploadPages) {
    await prisma.contactNotebookPage.delete({ where: { id: page.id } });
    await deleteBlobUrls([page.previewUrl, page.attachmentUrl, page.canvasUrl]);
  }

  return keep.id;
};

export const getOrCreateContactCanvas = async (input: {
  contactId: string;
  createdByStaffId?: string | null;
}) => {
  await consolidateContactCanvasPages(input.contactId);

  const existing = await prisma.contactNotebookPage.findFirst({
    where: { contactId: input.contactId, kind: NotebookPageKind.CANVAS },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: pageDetailSelect,
  });

  if (existing) return resolveDetail(existing);

  const page = await prisma.contactNotebookPage.create({
    data: {
      contactId: input.contactId,
      title: "Cuaderno",
      sortOrder: 0,
      kind: NotebookPageKind.CANVAS,
      background: NotebookPageBackground.BLANK,
      createdByStaffId: input.createdByStaffId ?? null,
    },
    select: pageDetailSelect,
  });

  return resolveDetail(page);
};

export const getNotebookPage = async (pageId: string, contactId: string) => {
  const page = await prisma.contactNotebookPage.findFirst({
    where: { id: pageId, contactId },
    select: pageDetailSelect,
  });
  return page ? resolveDetail(page) : null;
};

export const createNotebookPage = async (input: {
  contactId: string;
  title?: string;
  kind?: NotebookPageKind;
  background?: NotebookPageBackground;
  therapySessionId?: string | null;
  enrollmentId?: string | null;
  createdByStaffId?: string | null;
}) => {
  const kind = input.kind ?? NotebookPageKind.CANVAS;
  if (kind === NotebookPageKind.CANVAS) {
    const existing = await prisma.contactNotebookPage.findFirst({
      where: { contactId: input.contactId, kind: NotebookPageKind.CANVAS },
    });
    if (existing) {
      throw new Error("SINGLE_PAGE_ONLY");
    }
  }

  const count = await prisma.contactNotebookPage.count({
    where: { contactId: input.contactId },
  });
  if (count >= MAX_NOTEBOOK_PAGES_PER_CONTACT) {
    throw new Error("PAGE_LIMIT_REACHED");
  }

  const maxOrder = await prisma.contactNotebookPage.aggregate({
    where: { contactId: input.contactId },
    _max: { sortOrder: true },
  });
  const sortOrder = (maxOrder._max.sortOrder ?? -1) + 1;

  let therapySessionId = input.therapySessionId ?? null;
  let enrollmentId = input.enrollmentId ?? null;
  if (therapySessionId) {
    const ctx = await resolveSessionContext(input.contactId, therapySessionId);
    therapySessionId = ctx.therapySessionId;
    enrollmentId = ctx.enrollmentId ?? enrollmentId;
  }

  const pageNumber = sortOrder + 1;
  const page = await prisma.contactNotebookPage.create({
    data: {
      contactId: input.contactId,
      title: input.title?.trim() || `Hoja ${pageNumber}`,
      sortOrder,
      kind: input.kind ?? NotebookPageKind.CANVAS,
      background: input.background ?? NotebookPageBackground.BLANK,
      therapySessionId,
      enrollmentId,
      createdByStaffId: input.createdByStaffId ?? null,
    },
    select: pageDetailSelect,
  });

  return resolveDetail(page);
};

export const updateNotebookPage = async (
  pageId: string,
  contactId: string,
  data: {
    title?: string | null;
    kind?: NotebookPageKind;
    background?: NotebookPageBackground;
    canvasData?: unknown;
    bodyText?: string | null;
    therapySessionId?: string | null;
    enrollmentId?: string | null;
    attachmentUrl?: string | null;
    attachmentMime?: string | null;
    attachmentName?: string | null;
    previewUrl?: string | null;
  }
) => {
  const existing = await prisma.contactNotebookPage.findFirst({
    where: { id: pageId, contactId },
  });
  if (!existing) return null;

  // Canvas scenes go to Blob (DB keeps the pointer); the JSONB column is only
  // a fallback when Blob is unconfigured or the upload fails. In either
  // fallback the column stays authoritative because reads prefer it.
  let canvasColumnValue: Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined;
  let canvasUrlValue: string | null | undefined;
  if (data.canvasData !== undefined) {
    if (data.canvasData === null) {
      canvasColumnValue = Prisma.JsonNull;
      canvasUrlValue = null;
    } else {
      const serialized = JSON.stringify(data.canvasData);
      if (Buffer.byteLength(serialized, "utf8") > MAX_CANVAS_JSON_BYTES) {
        throw new Error("CANVAS_TOO_LARGE");
      }
      if (isBlobConfigured()) {
        try {
          canvasUrlValue = await saveCanvasSceneToBlob(
            contactId,
            pageId,
            serialized
          );
          canvasColumnValue = Prisma.JsonNull;
        } catch (err) {
          console.warn(
            `[notebook] Blob upload failed for page ${pageId}, falling back to DB:`,
            err instanceof Error ? err.message : err
          );
          canvasColumnValue = data.canvasData as Prisma.InputJsonValue;
        }
      } else {
        canvasColumnValue = data.canvasData as Prisma.InputJsonValue;
      }
    }
  }

  let therapySessionId = data.therapySessionId;
  let enrollmentId = data.enrollmentId;
  if (data.therapySessionId !== undefined) {
    if (data.therapySessionId) {
      const ctx = await resolveSessionContext(contactId, data.therapySessionId);
      therapySessionId = ctx.therapySessionId;
      enrollmentId = ctx.enrollmentId ?? enrollmentId ?? null;
    } else {
      therapySessionId = null;
    }
  }

  if (data.previewUrl && existing.previewUrl && data.previewUrl !== existing.previewUrl) {
    await deleteBlobUrls([existing.previewUrl]);
  }
  if (
    data.attachmentUrl &&
    existing.attachmentUrl &&
    data.attachmentUrl !== existing.attachmentUrl
  ) {
    await deleteBlobUrls([existing.attachmentUrl]);
  }

  const page = await prisma.contactNotebookPage.update({
    where: { id: pageId },
    data: {
      title:
        data.title === undefined || data.title === null
          ? undefined
          : data.title,
      kind: data.kind,
      background: data.background,
      canvasData: canvasColumnValue,
      canvasUrl: canvasUrlValue,
      bodyText: data.bodyText === undefined ? undefined : data.bodyText,
      therapySessionId:
        therapySessionId === undefined ? undefined : therapySessionId,
      enrollmentId: enrollmentId === undefined ? undefined : enrollmentId,
      attachmentUrl:
        data.attachmentUrl === undefined ? undefined : data.attachmentUrl,
      attachmentMime:
        data.attachmentMime === undefined ? undefined : data.attachmentMime,
      attachmentName:
        data.attachmentName === undefined ? undefined : data.attachmentName,
      previewUrl: data.previewUrl === undefined ? undefined : data.previewUrl,
    },
    select: pageListSelect,
  });

  if (
    typeof canvasUrlValue === "string" &&
    existing.canvasUrl &&
    existing.canvasUrl !== canvasUrlValue
  ) {
    await deleteBlobUrls([existing.canvasUrl]);
  } else if (canvasUrlValue === null && existing.canvasUrl) {
    await deleteBlobUrls([existing.canvasUrl]);
  }

  // Metadata only — echoing the scene back would make every autosave
  // round-trip the whole drawing.
  return mapListItem(page);
};

export const reorderNotebookPages = async (
  contactId: string,
  orderedIds: string[]
) => {
  const pages = await prisma.contactNotebookPage.findMany({
    where: { contactId },
    select: { id: true },
  });
  const validIds = new Set(pages.map((p) => p.id));
  if (orderedIds.length !== pages.length) {
    throw new Error("INVALID_ORDER");
  }
  for (const id of orderedIds) {
    if (!validIds.has(id)) throw new Error("INVALID_ORDER");
  }

  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.contactNotebookPage.update({
        where: { id },
        data: { sortOrder: index },
      })
    )
  );

  return listNotebookPages(contactId);
};

export const deleteNotebookPage = async (pageId: string, contactId: string) => {
  const page = await prisma.contactNotebookPage.findFirst({
    where: { id: pageId, contactId },
  });
  if (!page) return false;

  await prisma.contactNotebookPage.delete({ where: { id: pageId } });
  await deleteBlobUrls([page.previewUrl, page.attachmentUrl, page.canvasUrl]);
  return true;
};
