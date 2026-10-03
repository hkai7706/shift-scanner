import { openDB } from "idb";
import { initial, type State } from "./model";
const db = openDB("shiftly", 1, {
  upgrade(db) {
    db.createObjectStore("state");
  },
});
export async function read(): Promise<State> {
  return withScannerDefault(
    (await (await db).get("state", "main")) ?? structuredClone(initial),
  );
}
// Upgrade existing installations without altering their work records or custom endpoints.
function withScannerDefault(state: State): State {
  if (!state.settings.scannerUrl)
    state.settings.scannerUrl = initial.settings.scannerUrl;
  return state;
}
export async function mutate(fn: (s: State) => State) {
  const d = await db;
  const tx = d.transaction("state", "readwrite");
  const state = withScannerDefault(
    (await tx.store.get("main")) ?? structuredClone(initial),
  );
  const next = fn(state);
  await tx.store.put(next, "main");
  await tx.done;
  channel?.postMessage("changed");
  return next;
}
export const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("shiftly")
    : null;
