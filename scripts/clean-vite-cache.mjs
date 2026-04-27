import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const viteDir = path.join(__dirname, "..", "node_modules", ".vite");
if (fs.existsSync(viteDir)) {
  fs.rmSync(viteDir, { recursive: true, force: true });
  console.log("Removida a cache: node_modules/.vite");
} else {
  console.log("Nada a limpar: node_modules/.vite inexistente.");
}
