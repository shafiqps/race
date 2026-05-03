import { spawn } from "node:child_process";
import http from "node:http";

const children = [];

const serverHealthy = await checkHealth();
if (!serverHealthy) {
  children.push(spawn("npm", ["run", "server"], { stdio: "inherit" }));
}

children.push(spawn("npm", ["run", "dev:client"], { stdio: "inherit" }));

const shutdown = () => {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

for (const child of children) {
  child.on("exit", (code, signal) => {
    if (signal || code === 0) return;
    shutdown();
    process.exit(code ?? 1);
  });
}

function checkHealth() {
  return new Promise((resolve) => {
    const request = http.get("http://127.0.0.1:3001/health", (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.setTimeout(500, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}
