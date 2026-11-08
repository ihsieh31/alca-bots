import { receiveLoginHandoff, type ConnectionHandoffAnswer, type ConnectionHandoffWhat, type LoginHandoffResult } from "./login-handoff.ts";
import type { LoginStore } from "./login-store.ts";
import type { OnePasswordLogins } from "./onepassword.ts";
import type { LoginRouteDeps } from "./routes/logins.ts";

/** Saved logins and 1Password items, and the desktop's private handoff of one. */
export class BotLogins {
  readonly store: LoginStore;
  readonly onePassword: OnePasswordLogins;

  constructor(store: LoginStore, onePassword: OnePasswordLogins) {
    this.store = store;
    this.onePassword = onePassword;
  }

  /** The desktop main process's private ask for one login, for Send to My Cloud, or for a connection a move carries. */
  receiveHandoff(message: unknown, post: (reply: LoginHandoffResult) => boolean, connections?: (what: ConnectionHandoffWhat) => Promise<ConnectionHandoffAnswer>): boolean {
    return receiveLoginHandoff(message, this.store, post, () => this.onePassword.status().error, connections);
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
