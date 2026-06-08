import { ContactNoteKind, type Prisma } from "@prisma/client";
import { del } from "@vercel/blob";
import { prisma } from "../db";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export type ContactNoteListItem = {
  id: string;
  kind: ContactNoteKind;
  title: string | null;
  bodyText: string | null;
  therapySessionId: string | null;
  enrollmentId: string | null;
  attachmentUrl: string | null;
  attachmentMime: string | null;
  attachmentName: string | null;
  createdByStaffId: string | null;
  createdAt: string;
  sessionNumber: number | null;
  productTitle: string | null;
};

const noteSelect = {
  id: true,
  kind: true,
  title: true,
  bodyText: true,
  therapySessionId: true,
  enrollmentId: true,
  attachmentUrl: true,
  attachmentMime: true,
  attachmentName: true,
  createdByStaffId: true,
  createdAt: true,
  therapySession: { select: { sessionNumber: true } },
  enrollment: { select: { product: { select: { title: true } } } },
} satisfies Prisma.ContactNoteSelect;

const mapNote = (
  n: Prisma.ContactNoteGetPayload<{ select: typeof noteSelect }>
): ContactNoteListItem => ({
  id: n.id,
  kind: n.kind,
  title: n.title,
  bodyText: n.bodyText,
  therapySessionId: n.therapySessionId,
  enrollmentId: n.enrollmentId,
  attachmentUrl: n.attachmentUrl,
  attachmentMime: n.attachmentMime,
  attachmentName: n.attachmentName,
  createdByStaffId: n.createdByStaffId,
  createdAt: n.createdAt.toISOString(),
  sessionNumber: n.therapySession?.sessionNumber ?? null,
  productTitle: n.enrollment?.product.title ?? null,
});

export const listContactNotes = async (
  contactId: string,
  opts?: { cursor?: string; limit?: number }
) => {
  const limit = Math.min(opts?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const cursor = opts?.cursor;

  const notes = await prisma.contactNote.findMany({
    where: { contactId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor
      ? {
          cursor: { id: cursor },
          skip: 1,
        }
      : {}),
    select: noteSelect,
  });

  const hasMore = notes.length > limit;
  const items = hasMore ? notes.slice(0, limit) : notes;
  const nextCursor = hasMore ? items[items.length - 1]?.id : null;

  return {
    notes: items.map(mapNote),
    nextCursor,
    hasMore,
  };
};

export const createContactNote = async (input: {
  contactId: string;
  kind?: ContactNoteKind;
  title?: string | null;
  bodyText?: string | null;
  therapySessionId?: string | null;
  enrollmentId?: string | null;
  attachmentUrl?: string | null;
  attachmentMime?: string | null;
  attachmentName?: string | null;
  createdByStaffId?: string | null;
}) =>
  prisma.contactNote.create({
    data: {
      contactId: input.contactId,
      kind: input.kind ?? ContactNoteKind.TEXT,
      title: input.title ?? null,
      bodyText: input.bodyText ?? null,
      therapySessionId: input.therapySessionId ?? null,
      enrollmentId: input.enrollmentId ?? null,
      attachmentUrl: input.attachmentUrl ?? null,
      attachmentMime: input.attachmentMime ?? null,
      attachmentName: input.attachmentName ?? null,
      createdByStaffId: input.createdByStaffId ?? null,
    },
    select: noteSelect,
  }).then(mapNote);

export const updateContactNote = async (
  noteId: string,
  contactId: string,
  data: { title?: string | null; bodyText?: string | null }
) => {
  const note = await prisma.contactNote.updateMany({
    where: { id: noteId, contactId },
    data: {
      title: data.title,
      bodyText: data.bodyText,
    },
  });
  if (note.count === 0) return null;
  return prisma.contactNote.findUnique({
    where: { id: noteId },
    select: noteSelect,
  }).then((n) => (n ? mapNote(n) : null));
};

export const deleteContactNote = async (noteId: string, contactId: string) => {
  const note = await prisma.contactNote.findFirst({
    where: { id: noteId, contactId },
  });
  if (!note) return false;

  await prisma.contactNote.delete({ where: { id: noteId } });

  if (note.attachmentUrl) {
    try {
      await del(note.attachmentUrl);
    } catch {
      /* blob may already be gone */
    }
  }

  return true;
};

export const getContactNoteById = async (noteId: string, contactId: string) => {
  const note = await prisma.contactNote.findFirst({
    where: { id: noteId, contactId },
    select: noteSelect,
  });
  return note ? mapNote(note) : null;
};
