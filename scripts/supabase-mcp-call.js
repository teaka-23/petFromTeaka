// Usage: node supabase-mcp-call.js <toolName> '<jsonArgs>'
// Drives the Supabase MCP server over stdio and prints the tool result.
const { spawn } = require("child_process");
const fs = require("fs");

const tool = process.argv[2];
const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
const cfg = JSON.parse(fs.readFileSync("/Users/teaka/Documents/TAC/petFromTeaka/.kimi-code/mcp.json", "utf8"));
const server = cfg.mcpServers.supabase;

const p = spawn(server.command, server.args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...server.env } });
const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "kimi-bash-bridge", version: "0" } } });
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });

let buf = "";
p.stdout.on("data", (d) => {
  buf += d;
  for (const line of buf.split("\n")) {
    let m;
    try { m = JSON.parse(line); } catch { continue; }
    if (m.id === 2) {
      const r = m.result;
      if (m.error) { console.error("MCP error:", JSON.stringify(m.error)); }
      else if (r && r.content) r.content.forEach((c) => c.type === "text" && console.log(c.text));
      else console.log(JSON.stringify(r));
      p.kill();
      process.exit(m.error ? 1 : 0);
    }
  }
});
p.stderr.on("data", (d) => process.stderr.write(String(d).slice(0, 300)));
setTimeout(() => { console.error("TIMEOUT waiting for tool result"); p.kill(); process.exit(1); }, 90000);
