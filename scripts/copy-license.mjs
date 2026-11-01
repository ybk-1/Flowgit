// Copies the repo's LICENSE into the package being packed (run as `prepack`
// from packages/<name>), because npm only ships a LICENSE from the package's
// own folder.
import { copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

copyFileSync(fileURLToPath(new URL("../LICENSE", import.meta.url)), "LICENSE");
