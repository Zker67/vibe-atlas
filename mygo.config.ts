import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "Vibe Atlas",
  identifier: "io.github.zker67.vibeatlas",
  version: "0.6.2",
  // Signed updates from this repository's GitHub releases. The secret key
  // stays out of the repository: give it to `mygo build` in
  // MYGO_UPDATER_PRIVATE_KEY (docs/operations.md).
  updates: {
    publicKey: "korf/abyhxHCaT6DWC6f40Hl8AlFGtk0tSJeBBfyQAw=",
    github: "Zker67/vibe-atlas",
    // No delta updates: a release holds the installer, the portable zip
    // and the two files of the update alone (scripts/release.sh).
    deltas: 0,
  },
  // The installer in Simplified Chinese too.
  windows: { installerInclude: "installer.nsh" },
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
});
