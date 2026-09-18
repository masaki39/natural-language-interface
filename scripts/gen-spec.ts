import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateSpec, SPECS_DIR } from "../src/spec.ts";

const tool = process.argv[2] ?? "gh";
const spec = generateSpec(tool);
const file = join(SPECS_DIR, `${tool}.json`);
writeFileSync(file, `${JSON.stringify(spec, null, 2)}\n`);
console.log(`${file}: ${spec.commands.length} commands (${spec.version})`);
