import { defineConfig } from "bumpp";

export default defineConfig({
  files: ["package.json"],
  commit: "chore(release): v",
  tag: "v",
  push: true,
  confirm: true,
});
