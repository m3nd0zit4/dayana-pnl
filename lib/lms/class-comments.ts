import { prisma } from "@/lib/db";

const MAX_COMMENT_LENGTH = 2000;

export type LessonCommentRow = {
  id: string;
  body: string;
  createdAt: Date;
  contactId: string;
  contactFirstName: string;
};

const commentSelect = {
  id: true,
  body: true,
  createdAt: true,
  contactId: true,
  contact: { select: { firstName: true } },
} as const;

const toRow = (row: {
  id: string;
  body: string;
  createdAt: Date;
  contactId: string;
  contact: { firstName: string };
}): LessonCommentRow => ({
  id: row.id,
  body: row.body,
  createdAt: row.createdAt,
  contactId: row.contactId,
  contactFirstName: row.contact.firstName,
});

export const listCommentsForClass = async (
  classId: string
): Promise<LessonCommentRow[]> => {
  const rows = await prisma.lessonComment.findMany({
    where: { classId, hiddenAt: null },
    orderBy: { createdAt: "asc" },
    select: commentSelect,
  });
  return rows.map(toRow);
};

export class CommentValidationError extends Error {
  constructor(
    message: string,
    public code: "EMPTY" | "TOO_LONG" | "NOT_FOUND" | "FORBIDDEN"
  ) {
    super(message);
  }
}

export const addComment = async (
  classId: string,
  contactId: string,
  body: string
): Promise<LessonCommentRow> => {
  const trimmed = body.trim();
  if (!trimmed) {
    throw new CommentValidationError("Comment body is empty", "EMPTY");
  }
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw new CommentValidationError("Comment body too long", "TOO_LONG");
  }

  const row = await prisma.lessonComment.create({
    data: { classId, contactId, body: trimmed },
    select: commentSelect,
  });
  return toRow(row);
};

/** Self-service delete — throws FORBIDDEN if the comment belongs to someone else. */
export const deleteOwnComment = async (
  commentId: string,
  contactId: string
): Promise<void> => {
  const comment = await prisma.lessonComment.findUnique({
    where: { id: commentId },
    select: { contactId: true },
  });
  if (!comment) {
    throw new CommentValidationError("Comment not found", "NOT_FOUND");
  }
  if (comment.contactId !== contactId) {
    throw new CommentValidationError("Not your comment", "FORBIDDEN");
  }
  await prisma.lessonComment.update({
    where: { id: commentId },
    data: { hiddenAt: new Date() },
  });
};

/** Staff moderation delete — caller is responsible for auth + audit log. */
export const deleteCommentAsStaff = async (commentId: string): Promise<void> => {
  await prisma.lessonComment.update({
    where: { id: commentId },
    data: { hiddenAt: new Date() },
  });
};

export type RecentCommentRow = LessonCommentRow & {
  classId: string;
  classTitle: string;
  moduleId: string | null;
  moduleTitle: string | null;
};

/** Cross-class feed for the CRM "Comentarios" monitoring page — newest first. */
/** Un id o varios: la bandeja del admin junta los comentarios de toda la
 *  biblioteca, mientras que una vista de un solo curso pasa su id. */
export const listRecentCommentsForProduct = async (
  productId: string | string[],
  limit = 100
): Promise<RecentCommentRow[]> => {
  const rows = await prisma.lessonComment.findMany({
    where: {
      hiddenAt: null,
      class: {
        productId: Array.isArray(productId) ? { in: productId } : productId,
      },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      ...commentSelect,
      classId: true,
      class: {
        select: {
          title: true,
          moduleId: true,
          module: { select: { title: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    ...toRow(row),
    classId: row.classId,
    classTitle: row.class.title,
    moduleId: row.class.moduleId,
    moduleTitle: row.class.module?.title ?? null,
  }));
};
