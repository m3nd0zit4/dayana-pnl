import { prisma } from "@/lib/db";
import { writeAuditLog } from "./audit";
import {
  announceMessage,
  countByStatus,
  e164Candidates,
  matchPhonesToContacts,
  parsePastedPhones,
  type CommunityKind,
  type MemberStatus,
  type StatusCounts,
} from "./whatsapp-communities-core";
import { createSend } from "./whatsapp-sends";

export * from "./whatsapp-communities-core";

/**
 * Comunidades y grupos de WhatsApp en el CRM.
 *
 * El número de Dayana está en coexistencia (WhatsApp Business App + Cloud API)
 * y Meta no permite la API de grupos ahí: el CRM no lee ni escribe en los
 * grupos. Lo que sí hace: guardar cada comunidad con su enlace de invitación,
 * saber quién está, mandar la invitación 1 a 1 por WhatsApp (el envío masivo
 * de siempre, gratis dentro de 24 h y con plantilla afuera) y avisar novedades
 * 1 a 1 a quienes ya entraron. La conversación del grupo sigue en el celular.
 */

export class CommunityError extends Error {
  constructor(
    public code: "not_found" | "no_invite_link" | "no_recipients" | "empty_message",
    message: string
  ) {
    super(message);
  }
}

export const INVITE_TEMPLATE_KEY = "comunidad_invitacion";
export const ANNOUNCE_TEMPLATE_KEY = "comunidad_anuncio";

export type CommunityListItem = {
  id: string;
  name: string;
  kind: string;
  parentId: string | null;
  parentName: string | null;
  inviteLink: string | null;
  description: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  counts: StatusCounts;
};

export const listCommunities = async (
  opts: { q?: string; archived?: boolean } = {}
): Promise<CommunityListItem[]> => {
  const q = opts.q?.trim();
  const rows = await prisma.whatsAppCommunity.findMany({
    where: {
      archivedAt: opts.archived ? { not: null } : null,
      ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
    },
    orderBy: [{ name: "asc" }],
    include: { parent: { select: { name: true } } },
    take: 300,
  });
  const grouped = rows.length
    ? await prisma.whatsAppCommunityMember.groupBy({
        by: ["communityId", "status"],
        where: { communityId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      })
    : [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    parentId: r.parentId,
    parentName: r.parent?.name ?? null,
    inviteLink: r.inviteLink,
    description: r.description,
    archivedAt: r.archivedAt,
    createdAt: r.createdAt,
    counts: countByStatus(
      grouped.filter((g) => g.communityId === r.id).map((g) => ({ status: g.status, count: g._count._all }))
    ),
  }));
};

export const getCommunity = async (id: string) => {
  const community = await prisma.whatsAppCommunity.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true } },
      children: { where: { archivedAt: null }, select: { id: true, name: true } },
      members: {
        orderBy: [{ updatedAt: "desc" }],
        take: 3000,
        include: { contact: { select: { id: true, firstName: true, lastName: true, phoneE164: true } } },
      },
    },
  });
  if (!community) return null;
  return { ...community, counts: countByStatus(community.members) };
};

export type CommunityInput = {
  name: string;
  kind: CommunityKind;
  parentId?: string | null;
  inviteLink?: string | null;
  description?: string | null;
};

const clean = (s: string | null | undefined) => (s?.trim() ? s.trim() : null);

export const createCommunity = async (input: CommunityInput, staffId?: string) => {
  const created = await prisma.whatsAppCommunity.create({
    data: {
      name: input.name.trim(),
      kind: input.kind,
      parentId: input.parentId || null,
      inviteLink: clean(input.inviteLink),
      description: clean(input.description),
    },
  });
  await writeAuditLog({
    staffUserId: staffId,
    action: "WHATSAPP_COMMUNITY_CREATED",
    entityType: "WhatsAppCommunity",
    entityId: created.id,
    changes: { name: created.name, kind: created.kind },
  }).catch(() => undefined);
  return created;
};

export const updateCommunity = async (
  id: string,
  input: Partial<CommunityInput> & { archived?: boolean }
) => {
  // Un grupo no puede quedar dentro de sí mismo.
  const parentId = input.parentId === id ? null : input.parentId;
  return prisma.whatsAppCommunity.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(parentId !== undefined ? { parentId: parentId || null } : {}),
      ...(input.inviteLink !== undefined ? { inviteLink: clean(input.inviteLink) } : {}),
      ...(input.description !== undefined ? { description: clean(input.description) } : {}),
      ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}),
    },
  });
};

export const archiveCommunity = (id: string, archived = true) => updateCommunity(id, { archived });

/** Agrega personas (las que ya estaban no cambian). Devuelve cuántas son nuevas. */
export const addMembers = async (
  communityId: string,
  contactIds: string[],
  status: MemberStatus = "INVITED",
  joinedVia: "manual" | "bulk_paste" | "reply" = "manual"
): Promise<number> => {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return 0;
  const now = new Date();
  const res = await prisma.whatsAppCommunityMember.createMany({
    data: ids.map((contactId) => ({
      communityId,
      contactId,
      status,
      joinedVia: status === "JOINED" ? joinedVia : null,
      joinedAt: status === "JOINED" ? now : null,
    })),
    skipDuplicates: true,
  });
  return res.count;
};

export const setMemberStatus = async (
  communityId: string,
  contactIds: string[],
  status: MemberStatus,
  joinedVia: "manual" | "bulk_paste" | "reply" = "manual"
): Promise<number> => {
  const ids = [...new Set(contactIds.filter(Boolean))];
  if (!ids.length) return 0;
  const where = { communityId, contactId: { in: ids } };
  if (status === "JOINED") {
    // La fecha de entrada es la primera vez; si ya estaba, no se toca.
    const res = await prisma.whatsAppCommunityMember.updateMany({
      where: { ...where, status: { not: "JOINED" } },
      data: { status, joinedAt: new Date(), joinedVia },
    });
    return res.count;
  }
  const res = await prisma.whatsAppCommunityMember.updateMany({ where, data: { status } });
  return res.count;
};

export type PasteMatch = {
  contactId: string;
  name: string;
  phone: string;
  input: string;
  /** Estado antes de marcar (null: no era miembro). */
  previous: MemberStatus | null;
};

/**
 * Números pegados desde la info del grupo → quiénes son en el CRM. Con
 * `apply`, los deja como JOINED (agregando a quien no estaba).
 */
export const markJoinedByPhones = async (
  communityId: string,
  rawText: string,
  opts: { apply?: boolean } = { apply: true }
): Promise<{ matched: PasteMatch[]; unknown: string[]; updated: number }> => {
  const parsed = parsePastedPhones(rawText);
  const contacts = parsed.length
    ? await prisma.contact.findMany({
        where: { phoneE164: { in: e164Candidates(parsed) } },
        select: { id: true, phoneE164: true, firstName: true, lastName: true },
      })
    : [];
  const { matched, unknown } = matchPhonesToContacts(parsed, contacts);
  const existing = matched.length
    ? await prisma.whatsAppCommunityMember.findMany({
        where: { communityId, contactId: { in: matched.map((m) => m.contact.id) } },
        select: { contactId: true, status: true },
      })
    : [];
  const prev = new Map(existing.map((e) => [e.contactId, e.status as MemberStatus]));
  const out: PasteMatch[] = matched.map((m) => ({
    contactId: m.contact.id,
    name: [m.contact.firstName, m.contact.lastName].filter(Boolean).join(" "),
    phone: m.contact.phoneE164,
    input: m.input,
    previous: prev.get(m.contact.id) ?? null,
  }));
  let updated = 0;
  if (opts.apply && out.length) {
    const ids = out.map((m) => m.contactId);
    updated += await addMembers(communityId, ids.filter((id) => !prev.has(id)), "JOINED", "bulk_paste");
    updated += await setMemberStatus(communityId, ids.filter((id) => prev.has(id)), "JOINED", "bulk_paste");
  }
  return { matched: out, unknown, updated };
};

const communityOrThrow = async (id: string) => {
  const c = await prisma.whatsAppCommunity.findUnique({ where: { id } });
  if (!c) throw new CommunityError("not_found", "La comunidad no existe.");
  return c;
};

export const inviteText = (name: string, link: string) =>
  `Hola {{nombre}}, te bendigo 💛 Te invito a unirte a ${name}. Entra con este enlace: ${link} ¡Te espero!`;

/**
 * Invita por WhatsApp (1 a 1) con el enlace: quedan como INVITED y se arma el
 * envío masivo. Sin `contactIds`, a las invitadas a las que aún no se les
 * mandó. A quien ya está en la comunidad no se le vuelve a invitar.
 */
export const invite = async (
  communityId: string,
  contactIds: string[] | null | undefined,
  staffId: string,
  opts: { text?: string } = {}
): Promise<{ sendId: string; total: number }> => {
  const c = await communityOrThrow(communityId);
  if (!c.inviteLink) throw new CommunityError("no_invite_link", "Falta el enlace de invitación de la comunidad.");

  let ids: string[];
  if (contactIds?.length) {
    await addMembers(communityId, contactIds, "INVITED");
    const rows = await prisma.whatsAppCommunityMember.findMany({
      where: { communityId, contactId: { in: contactIds }, status: { not: "JOINED" } },
      select: { contactId: true },
    });
    ids = rows.map((r) => r.contactId);
  } else {
    const rows = await prisma.whatsAppCommunityMember.findMany({
      where: { communityId, status: "INVITED", inviteSendId: null },
      select: { contactId: true },
    });
    ids = rows.map((r) => r.contactId);
  }
  if (!ids.length) throw new CommunityError("no_recipients", "No hay a quién invitar.");

  const text = opts.text?.trim() || inviteText(c.name, c.inviteLink);
  const send = await createSend({
    title: `Invitación · ${c.name}`,
    kind: "comunidad",
    text,
    templateKey: INVITE_TEMPLATE_KEY,
    vars: { comunidad: c.name, enlace: c.inviteLink },
    contactIds: ids,
    staffId,
  });
  await prisma.whatsAppCommunityMember.updateMany({
    where: { communityId, contactId: { in: ids }, status: { in: ["INVITED", "LEFT", "DECLINED"] } },
    data: { status: "INVITED", invitedAt: new Date(), inviteSendId: send.id },
  });
  return { sendId: send.id, total: send.total };
};

/** Un anuncio 1 a 1 a quienes están en la comunidad (JOINED). */
export const announce = async (
  communityId: string,
  text: string,
  staffId: string
): Promise<{ sendId: string; total: number }> => {
  const c = await communityOrThrow(communityId);
  const mensaje = announceMessage(text, c.name);
  if (!text.trim() || !mensaje) throw new CommunityError("empty_message", "Escribe el anuncio.");
  const rows = await prisma.whatsAppCommunityMember.findMany({
    where: { communityId, status: "JOINED" },
    select: { contactId: true },
  });
  if (!rows.length) throw new CommunityError("no_recipients", "Todavía no hay miembros.");
  const send = await createSend({
    title: `Anuncio · ${c.name}`,
    kind: "comunidad",
    text: text.trim(),
    templateKey: ANNOUNCE_TEMPLATE_KEY,
    vars: { comunidad: c.name, mensaje },
    contactIds: rows.map((r) => r.contactId),
    staffId,
  });
  return { sendId: send.id, total: send.total };
};
