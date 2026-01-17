import { defineConfig } from "bumpp";

export default defineConfig({
  files: ["package.json"],
  commit: "chore(release): v{version}",
  tag: "v{version}",
  push: true,
  confirm: true,
});
