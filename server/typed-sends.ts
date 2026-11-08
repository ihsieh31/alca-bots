// The sends a person typed themselves, noted at the one route that can tell: a paired session or the desktop's own page,
// and no button press, app or relay. Only these can call a skill past the start of a message, so a webhook, an app's words
// or another bot's shell on this machine never can. Bound to the thread and the words: a bot that reads a person's sendId
// in a transcript cannot lend it to words of its own. In memory on purpose: a queued line that outlives a restart only
// falls back to the start-of-message rule.
import { createHash } from "node:crypto";

const SENDS_KEPT = 500;
const sends = new Set<string>();
const proof = (threadId: string, sendId: string, text: string): string =>
  createHash("sha256").update(JSON.stringify([threadId, sendId, text])).digest("base64");

export function noteTypedSend(threadId: string, sendId: string, text: string): void {
  const key = proof(threadId, sendId, text);
  sends.delete(key);
  sends.add(key);
  for (const oldest of sends) {
    if (sends.size <= SENDS_KEPT) break;
    sends.delete(oldest);
  }
}

/** What the person typed themselves among a turn's own lines; empty when they typed none of them. */
export function typedWords(threadId: string, lines: ReadonlyArray<{ sendId?: string; text?: string }>): string {
  return lines
    .filter((line) => line.sendId !== undefined && line.text !== undefined && sends.has(proof(threadId, line.sendId, line.text)))
    .map((line) => line.text)
    .join("\n\n");
}
