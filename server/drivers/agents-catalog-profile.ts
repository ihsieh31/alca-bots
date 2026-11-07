// The ALCA_* switches the harness gives the agents proxy, read into the profile agents-catalog.ts lists tools for.

/** Which tools a conversation is shown, the same on every one of its turns. Presentation only: the server still
 * authenticates and scopes every call. */
export interface CatalogProfile {
  skillAuthoring: boolean;
  sharedComputers: boolean;
  voiceNotes: boolean;
  /** A treg key or a Cloud plan's research credential is held and this bot's research switch is on: x_search is mounted.
   * Absent means off. */
  xResearch?: boolean;
  /** As xResearch, and research works for that credential (the person's treg key, or a plan whose relay has research
   * on): research_search, research_endpoint and research_call are mounted too. Absent means off. */
  research?: boolean;
  cloudHome: boolean;
  memoryEnabled?: boolean;
  /** The section's Chief of Staff; the server refuses Chief-only tools to every other bot. */
  chief: boolean;
  /** Only for Watcher's own tool. Never written into a schema: a list that names its bot can't share a prompt cache with other bots. */
  botId: string;
  /** features.chiefEscalations: raise_escalation is mounted. */
  escalations?: boolean;
  /** A Team Cloud: message_person is mounted. */
  team?: boolean;
  /** The person's AlcaBot with a Chief's powers: its notification tools are mounted. */
  alcabot?: boolean;
  /** A direct chat whose bot may pick where it works (Works on is not Off and no team computer is its own): select_computer
   * is mounted, and the harness refuses a pick on any turn but a person's own message. */
  computerSelection?: boolean;
  /** A room's thread: the wait tools are not mounted, since a room holds no wait. */
  room?: boolean;
  imageGeneration?: boolean;
  /** A cloud computer can be had here (Boat): the meeting tools are mounted. */
  meetings?: boolean;
}

/** Everything is off unless the harness says "1". */
export function catalogProfileFromEnv(env: NodeJS.ProcessEnv): CatalogProfile {
  return {
    skillAuthoring: env.ALCA_SKILL_AUTHORING_ENABLED === "1",
    sharedComputers: env.ALCA_SHARED_COMPUTERS_ENABLED === "1",
    voiceNotes: env.ALCA_VOICE_NOTES === "1",
    xResearch: env.ALCA_X_RESEARCH === "1",
    research: env.ALCA_RESEARCH === "1",
    cloudHome: env.ALCA_CLOUD_HOME === "1",
    memoryEnabled: env.ALCA_MEMORY_ENABLED !== "0",
    chief: env.ALCA_CHIEF_OF_STAFF === "1",
    botId: env.ALCA_BOT_ID ?? "",
    escalations: env.ALCA_ESCALATIONS === "1",
    team: env.ALCA_TEAM_PEOPLE === "1",
    alcabot: env.ALCA_ALCABOT === "1",
    computerSelection: env.ALCA_COMPUTER_SELECTION === "1",
    room: env.ALCA_ROOM === "1",
    imageGeneration: env.ALCA_IMAGE_GENERATION === "1",
    meetings: env.ALCA_MEETINGS === "1",
  };
}
