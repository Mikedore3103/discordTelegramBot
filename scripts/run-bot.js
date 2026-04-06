import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const shouldLog = process.argv.includes("--log");
const logPath = path.join(projectRoot, "bot.log");

const child = spawn(process.execPath, ["index.js"], {
  cwd: projectRoot,
  stdio: ["inherit", "pipe", "pipe"],
});

let logStream;

if (shouldLog) {
  logStream = fs.createWriteStream(logPath, { flags: "a" });
  const startedAt = new Date().toISOString();
  logStream.write(`\n=== Bot run started at ${startedAt} ===\n`);
  console.log(`Writing bot output to ${logPath}`);
}

forward(child.stdout, process.stdout, logStream);
forward(child.stderr, process.stderr, logStream);

child.on("exit", (code, signal) => {
  if (logStream) {
    const endedAt = new Date().toISOString();
    logStream.write(`=== Bot run ended at ${endedAt} (code=${code ?? "null"}, signal=${signal ?? "null"}) ===\n`);
    logStream.end();
  }

  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

for (const eventName of ["SIGINT", "SIGTERM"]) {
  process.on(eventName, () => {
    child.kill(eventName);
  });
}

function forward(source, target, stream) {
  source.on("data", (chunk) => {
    target.write(chunk);

    if (stream) {
      stream.write(chunk);
    }
  });
}
