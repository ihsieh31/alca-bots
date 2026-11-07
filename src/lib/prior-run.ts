// Read before main.tsx's first-paint writes: applySkin stamps alca-skin on every boot.
const PRIOR_RUN_KEYS = ["alca-skin", "alca-installed", "alca-email-gate", "alca-drafts", "alca-show-threads"];

export function hasPriorRun(store: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return PRIOR_RUN_KEYS.some((key) => store?.getItem(key) != null);
  } catch {
    return false;
  }
}
