import {
  NotebookPageBackground,
  NotebookPageKind,
  Prisma,
} from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "../db";

export const MAX_NOTEBOOK_PAGES_PER_CONTACT = 200;
export const MAX_CANVAS_JSON_BYTES = 2 * 1024 * 1024;

const pageListSelect = {
  id: true,
  contactId: true,
  title: true,
  sortOrder: true,
  kind: true,
  background: true,
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

const mapDetail = (p: PageDetailRow): NotebookPageDetail => ({
  ...mapListItem(p),
  canvasData: p.canvasData ?? null,
});

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

export const assertCanvasDataSize = (data: unknown) => {
  if (data == null) return;
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > MAX_CANVAS_JSON_BYTES) {
    throw new Error("CANVAS_TOO_LARGE");
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
  const pages = await prisma.contactNotebookPage.findMany({
    where: { contactId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: pageListSelect,
  });
  return pages.map(mapListItem);
};

export const getNotebookPage = async (pageId: string, contactId: string) => {
  const page = await prisma.contactNotebookPage.findFirst({
    where: { id: pageId, contactId },
    select: pageDetailSelect,
  });
  return page ? mapDetail(page) : null;
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

  return mapDetail(page);
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

  if (data.canvasData !== undefined) {
    assertCanvasDataSize(data.canvasData);
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
      canvasData:
        data.canvasData === undefined
          ? undefined
          : data.canvasData === null
            ? Prisma.JsonNull
            : (data.canvasData as Prisma.InputJsonValue),
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
    select: pageDetailSelect,
  });

  return mapDetail(page);
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
  await deleteBlobUrls([page.previewUrl, page.attachmentUrl]);
  return true;
};
