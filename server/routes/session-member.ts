// Who a team session speaks for, when the team vouched for it.
import type { TeamMember } from "../cloud-team.ts";
import type { SessionRecord } from "../sessions.ts";

export function sessionMember(session: Pick<SessionRecord, "membershipAuthority" | "email" | "teamRole" | "createdAt" | "memberCheckedAt">): { member: TeamMember; checkedAt: number } | null {
  if (session.membershipAuthority !== "team" || !session.email || !session.teamRole) return null;
  return { member: { email: session.email, role: session.teamRole }, checkedAt: session.memberCheckedAt ?? session.createdAt };
}
