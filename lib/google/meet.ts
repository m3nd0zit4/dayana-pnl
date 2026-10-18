import { throwGoogleApiError } from "./api-error";

/**
 * Google Meet (API REST v2), solo lo que usa el aviso de sesión sin asistir:
 * de un enlace de Meet, la reunión de ahora (o la más reciente desde `since`)
 * y quién entró. A mano, como `calendar.ts`.
 *
 * Google la documenta para cuentas de Google Workspace; con una cuenta de
 * Gmail hay que probarla (`GET /api/admin/whatsapp/no-show`). Si Google la
 * rechaza, el aviso no sale: nunca se adivina si la persona entró.
 */

const MEET_BASE = "https://meet.googleapis.com/v2";

const request = async <T>(token: string, path: string): Promise<T> => {
  const res = await fetch(`${MEET_BASE}/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) await throwGoogleApiError("meet", res);
  return (await res.json()) as T;
};

type Space = { name: string; activeConference?: { conferenceRecord?: string } };
type ConferenceRecord = { name: string; startTime?: string; endTime?: string; space?: string };
type Participant = {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};

export type MeetParticipant = {
  /** `users/123…` si entró con su cuenta de Google. */
  user: string | null;
  displayName: string | null;
  joinedAt: string | null;
  /** Nulo mientras sigue dentro. */
  leftAt: string | null;
};

export type MeetConference = {
  startTime: string;
  endTime: string | null;
  participants: MeetParticipant[];
};

/**
 * La reunión de ese código: la que está en curso, o si no hay, la última que
 * empezó después de `since`. `null` si nadie la abrió.
 */
export const meetConferenceFor = async (token: string, code: string, since: Date): Promise<MeetConference | null> => {
  const space = await request<Space>(token, `spaces/${encodeURIComponent(code)}`);
  let recordName = space.activeConference?.conferenceRecord ?? null;
  if (!recordName) {
    const filter = `space.name = "${space.name}" AND start_time >= "${since.toISOString()}"`;
    const list = await request<{ conferenceRecords?: ConferenceRecord[] }>(
      token,
      `conferenceRecords?filter=${encodeURIComponent(filter)}&pageSize=5`
    );
    recordName =
      [...(list.conferenceRecords ?? [])].sort((a, b) => (b.startTime ?? "").localeCompare(a.startTime ?? ""))[0]?.name ?? null;
  }
  if (!recordName) return null;
  const record = await request<ConferenceRecord>(token, recordName);
  if (!record.startTime || new Date(record.startTime).getTime() < since.getTime()) return null;

  const participants: MeetParticipant[] = [];
  let pageToken: string | undefined;
  do {
    const page = await request<{ participants?: Participant[]; nextPageToken?: string }>(
      token,
      `${recordName}/participants?pageSize=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
    );
    for (const p of page.participants ?? []) {
      participants.push({
        user: p.signedinUser?.user ?? null,
        displayName: p.signedinUser?.displayName ?? p.anonymousUser?.displayName ?? p.phoneUser?.displayName ?? null,
        joinedAt: p.earliestStartTime ?? null,
        leftAt: p.latestEndTime ?? null,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken && participants.length < 300);

  return { startTime: record.startTime, endTime: record.endTime ?? null, participants };
};

/** Quién es la cuenta del token (`sub` de Google = el `users/{id}` de Meet). */
export const googleUserId = async (token: string): Promise<{ id: string | null; name: string | null }> => {
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return { id: null, name: null };
  const info = (await res.json()) as { sub?: string; name?: string };
  return { id: info.sub ?? null, name: info.name ?? null };
};
