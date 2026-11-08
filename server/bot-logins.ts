import { browserMatesOf, type LoginPlace } from "../shared/logins.ts";
import { receiveLoginHandoff, type ConnectionHandoffAnswer, type ConnectionHandoffWhat, type LoginHandoffResult } from "./login-handoff.ts";
import type { LoginStore } from "./login-store.ts";
import type { OnePasswordLogins } from "./onepassword.ts";
import type { LoginRouteDeps } from "./routes/logins.ts";

/** Saved logins and 1Password items, as each bot may use them. A login kept to some bots is filled only where every bot
 * sharing that browser may use it: a sign-in stays in the browser, so a bot sharing it would be signed in as well. */
export class BotLogins {
  readonly store: LoginStore;
  readonly onePassword: OnePasswordLogins;
  private readonly bots: () => ReadonlyArray<{ id: string; browserProfile?: string | null }>;

  constructor(store: LoginStore, onePassword: OnePasswordLogins, bots: () => ReadonlyArray<{ id: string; browserProfile?: string | null }> = () => []) {
    this.store = store;
    this.onePassword = onePassword;
    this.bots = bots;
  }

  /** The bot and every other bot that signs in through its browser: who a login saved from its sign-in card is kept
   * to, since a sign-in there reaches all of them. */
  cardBots(botId: string): string[] {
    return [botId, ...browserMatesOf(this.bots(), botId)];
  }

  /** The desktop main process's private ask for one login, for Send to My Cloud, or for a connection a move carries. */
  receiveHandoff(message: unknown, post: (reply: LoginHandoffResult) => boolean, connections?: (what: ConnectionHandoffWhat) => Promise<ConnectionHandoffAnswer>): boolean {
    return receiveLoginHandoff(message, this.store, post, () => this.onePassword.status().error, connections);
  }

  /** Where each login the bot may use fills, with its username. */
  sitesFor(botId: string): Array<LoginPlace & { username: string }> {
    const bots = this.cardBots(botId);
    return [...this.store.sitesFor(bots), ...this.onePassword.sitesFor(bots)];
  }

  markUsed(id: string): void {
    this.store.markUsed(id);
    this.onePassword.markUsed(id);
  }

  /** The settings, plus whether a 1Password token is held: what a credential card's "configured" check reads. */
  credentialConfig<T extends object>(config: T): T & { onePassword: { connected: boolean } } {
    return { ...config, onePassword: { connected: Boolean(this.store.onePasswordToken()) } };
  }

  routes(botExists: (id: string) => boolean): LoginRouteDeps {
    return {
      list: () => this.store.list(),
      create: (input) => this.store.create(input),
      update: (id, patch) => this.store.update(id, patch),
      remove: (id) => this.store.remove(id),
      botExists,
      onePassword: {
        status: () => this.onePassword.status(),
        list: () => { void this.onePassword.fresh(); return this.onePassword.list(); },
        connect: async (token) => {
          const status = await this.onePassword.refresh(token);
          this.store.setOnePasswordToken(token);
          return status;
        },
        refresh: () => this.onePassword.refresh(),
        disconnect: () => {
          this.store.setOnePasswordToken(null);
          this.onePassword.clear();
          return this.onePassword.status();
        },
        grant: (vaultId, bots) => {
          if (!this.onePassword.hasVault(vaultId)) return null;
          this.store.setOnePasswordGrant(vaultId, bots);
          return this.onePassword.status();
        },
      },
    };
  }
}
