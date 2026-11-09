import { create } from "zustand";
import { Atlas, events, type UpdateState } from "@/mygo";
import { errorMessage, runOk } from "@/lib/api";

interface UpdatesState {
  /** What Go says of updating; null until it is loaded. */
  update: UpdateState | null;
  /** Why the last check the user asked for failed, or "". */
  checkError: string;
  /** The user's check found the app up to date. */
  upToDate: boolean;
  /** The version the user put off with 稍后, which the toast does not offer again while the app runs. */
  later: string;
}

export const useUpdates = create<UpdatesState>(() => ({ update: null, checkError: "", upToDate: false, later: "" }));

let started = false;

/** Loads the state of updating and follows it. */
export async function initUpdates() {
  if (started) return;
  started = true;
  events.updateChanged.on((update) => useUpdates.setState({ update }));
  try {
    const update = await Atlas.updateState();
    useUpdates.setState({ update });
  } catch {
    // The settings show the version once a check or event brings it.
  }
}

/** Checks for a newer version, as the user asked from the settings. */
export async function checkForUpdates() {
  useUpdates.setState({ checkError: "", upToDate: false, later: "" });
  try {
    const update = await Atlas.checkForUpdates();
    useUpdates.setState({ update, upToDate: update.phase === "idle" });
  } catch (e) {
    useUpdates.setState({ checkError: errorMessage(e) });
  }
}

/** Downloads the newer version; the app starts again in it. */
export function installUpdate() {
  void runOk(Atlas.installUpdate());
}

/** The releases on GitHub: the installers of every version. */
export const RELEASES_URL = "https://github.com/Zker67/vibe-atlas/releases";

/** Opens the latest release on GitHub, to download its installer by hand. */
export function openReleases() {
  void runOk(Atlas.openLink(`${RELEASES_URL}/latest`));
}

/** Puts off the newer version until the app starts again. */
export function updateLater() {
  useUpdates.setState((s) => ({ later: s.update?.available ?? "" }));
}
