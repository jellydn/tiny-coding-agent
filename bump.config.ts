import { defineConfig } from "bumpp";

export default defineConfig({
  files: ["package.json"],
  commit: "chore(release): v{newVersion}",
  tag: "v{newVersion}",
  push: true,
  confirm: true,
});
