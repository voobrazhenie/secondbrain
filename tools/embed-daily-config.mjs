import { readFile, writeFile } from "node:fs/promises";

const configPath = new URL("../dailyplan/daily.json", import.meta.url);
const htmlPath = new URL("../dailyplan/index.html", import.meta.url);
const config = JSON.parse(await readFile(configPath, "utf8"));
const html = await readFile(htmlPath, "utf8");
const next = html.replace(/const FALLBACK = \{.*?\};\r?\n/s, `const FALLBACK = ${JSON.stringify(config)};\n`);
if (next === html) throw new Error("Embedded DailyPlan fallback was not found");
await writeFile(htmlPath, next);
