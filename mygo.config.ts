import { defineConfig } from "mygo-cli";

export default defineConfig({
  name: "Vibe Atlas",
  identifier: "io.github.zker67.vibeatlas",
  version: "0.4.0",
  // Signed updates from this repository's GitHub releases. The secret key
  // stays out of the repository: give it to `mygo build` in
  // MYGO_UPDATER_PRIVATE_KEY (docs/operations.md).
  updates: {
    publicKey: "korf/abyhxHCaT6DWC6f40Hl8AlFGtk0tSJeBBfyQAw=",
    github: "Zker67/vibe-atlas",
  },
  // `mygo dev` runs devCommand and loads devUrl; `mygo build` runs
  // buildCommand and embeds frontendDist into the app.
  devUrl: "http://localhost:5173",
  devCommand: "bun run dev:web",
  buildCommand: "bun run build:web",
  frontendDist: "dist",
  bindings: "src/mygo.ts",
  out: "build",
});
