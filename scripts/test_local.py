"""
Starts the local SourceWhale MCP server the same way Claude does, then calls
each tool and prints what comes back. Usage: python3 scripts/test_local.py
"""
import json, subprocess, sys, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
proc = subprocess.Popen([os.path.join(ROOT, "node_modules/.bin/tsx"), os.path.join(ROOT, "src/local.ts")],
                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, cwd="/")
next_id = 0

def send(method, params=None, notify=False):
    global next_id
    msg = {"jsonrpc": "2.0", "method": method, "params": params or {}}
    if not notify:
        next_id += 1; msg["id"] = next_id
    proc.stdin.write(json.dumps(msg) + "\n"); proc.stdin.flush()
    if notify: return None
    while True:
        line = proc.stdout.readline()
        if not line: sys.exit("Server stopped: " + proc.stderr.read())
        reply = json.loads(line)
        if reply.get("id") == next_id: return reply

def call(name, args):
    r = send("tools/call", {"name": name, "arguments": args})
    if "error" in r: return f"PROTOCOL ERROR: {r['error']}"
    res = r["result"]; body = "\n".join(c.get("text", "") for c in res["content"])
    return ("[isError] " if res.get("isError") else "") + body

init = send("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}})
print("Server:", init["result"]["serverInfo"], "protocol", init["result"]["protocolVersion"])
send("notifications/initialized", notify=True)
print("Tools offered:", [t["name"] for t in send("tools/list")["result"]["tools"]])

tests = [(t[0], json.loads(t[1])) for t in (a.split(" ", 1) for a in sys.argv[1:])] or []
for name, args in tests:
    print(f"\n===== {name} {json.dumps(args)}\n{call(name, args)}")
proc.terminate()
