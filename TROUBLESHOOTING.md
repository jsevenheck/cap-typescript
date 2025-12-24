# Local Development Troubleshooting Guide

This guide helps diagnose and fix issues when your local development setup is not working, specifically when the backend does not respond to requests.

## Table of Contents

1. [Top Hypotheses](#1-top-hypotheses)
2. [Minimal Reproducible Test Plan](#2-minimal-reproducible-test-plan)
3. [Network/Routing Checklist](#3-networkrouting-checklist)
4. [Backend-Specific Checklist](#4-backend-specific-checklist)
5. [Approuter-Specific Checklist](#5-approuter-specific-checklist)
6. [Quick Diagnostic Summary](#6-quick-diagnostic-summary)

---

## 1. Top Hypotheses

Ranked by likelihood for "backend doesn't respond at all" across both direct and approuter setups:

| Rank | Hypothesis | Symptoms |
|------|------------|----------|
| 1 | **Backend process not running** | No process listening on port 4004, curl hangs or connection refused |
| 2 | **Database not deployed or missing** | Backend starts but crashes immediately, "SQLITE_CANTOPEN" errors |
| 3 | **Dependencies not installed** | Module not found errors, missing packages |
| 4 | **Port already in use** | "EADDRINUSE" error, another process on 4004 |
| 5 | **TypeScript compilation errors** | Server never reaches "listening" state, syntax errors in logs |
| 6 | **Blocking initialization code** | Server starts but never accepts connections, no "listening" message |
| 7 | **Wrong Node.js version** | Cryptic errors, incompatible module errors |
| 8 | **Approuter misconfiguration** | Approuter works but can't reach backend destination |
| 9 | **Firewall/VPN interference** | Connection timeouts, blocked ports |
| 10 | **Missing environment variables** | API key warnings, auth failures |

---

## 2. Minimal Reproducible Test Plan

### Step 1: Check if the backend process is running

**Command (macOS/Linux):**
```bash
ps aux | grep -E "(cds|node.*server)" | grep -v grep
```

**Command (Windows PowerShell):**
```powershell
Get-Process | Where-Object {$_.ProcessName -match "node"} | Select-Object Id, ProcessName, Path
```

**Expected output if healthy:**
```
user  12345  0.5  1.2  node /path/to/cds watch
```

**If unhealthy:** No output means the backend is not running. Start it with:
```bash
npm run watch --workspace srv
```

---

### Step 2: Check which port the backend is bound to

**Command:**
```bash
lsof -i :4004 -P -n
```

**Alternative (netstat):**
```bash
netstat -tlnp 2>/dev/null | grep 4004 || netstat -an | grep 4004
```

**Windows:**
```powershell
netstat -ano | findstr :4004
```

**Expected output if healthy:**
```
node    12345 user   23u  IPv6 0x...  TCP *:4004 (LISTEN)
```

**If unhealthy:**
- No output: Backend is not listening on port 4004
- Different process: Another application is using port 4004 (port conflict)

---

### Step 3: Check if the port is reachable locally

**Command (curl):**
```bash
curl -v --connect-timeout 5 http://localhost:4004/health
```

**Expected output if healthy:**
```
< HTTP/1.1 200 OK
{"status":"healthy","timestamp":"...","checks":{"database":"connected"}}
```

**If unhealthy:**

| Output | Meaning |
|--------|---------|
| `Connection refused` | Backend process not listening |
| `Connection timed out` | Firewall blocking or wrong binding |
| `Empty reply from server` | Backend crashed during request |
| `503 Service Unavailable` | Backend running but database not connected |

---

### Step 4: Try alternative host bindings

If `localhost` fails, try:

```bash
curl -v --connect-timeout 5 http://127.0.0.1:4004/health
curl -v --connect-timeout 5 http://0.0.0.0:4004/health
curl -v --connect-timeout 5 http://[::1]:4004/health
```

**Why this matters:** Some systems resolve `localhost` differently. If `127.0.0.1` works but `localhost` doesn't, check `/etc/hosts`.

---

### Step 5: Inspect backend logs

**Start with verbose logging:**
```bash
DEBUG=* npm run watch --workspace srv 2>&1 | tee backend.log
```

**Or check existing logs:**
```bash
# If running in background, check npm output
cat ~/.npm/_logs/*.log | tail -100
```

**Look for:**
```
[cds] - serving ClientService { path: '/odata/v4/clients' }
[cds] - server listening on { url: 'http://localhost:4004' }
```

**Red flags:**
- `SQLITE_CANTOPEN` → Database not deployed
- `MODULE_NOT_FOUND` → Dependencies not installed
- `EADDRINUSE` → Port conflict
- No "listening" message → Startup blocked

---

### Step 6: Verify database exists

**Command:**
```bash
ls -la db/sqlite.db
```

**Expected output if healthy:**
```
-rw-r--r--  1 user  staff  xxxxx  date time db/sqlite.db
```

**If unhealthy (file missing):**
```bash
npm run deploy
```

---

### Step 7: Verify dependencies are installed

**Command:**
```bash
# Check root dependencies
ls node_modules/@sap/cds 2>/dev/null && echo "Root OK" || echo "Root MISSING"

# Check srv workspace dependencies  
ls srv/node_modules/@sap/cds 2>/dev/null && echo "Srv OK" || echo "Srv MISSING"

# Check approuter dependencies
ls approuter/node_modules/@sap/approuter 2>/dev/null && echo "Approuter OK" || echo "Approuter MISSING"
```

**If any are missing:**
```bash
npm install
cd approuter && npm install && cd ..
```

---

### Step 8: Check Node.js version

**Command:**
```bash
node --version
```

**Expected:** `v20.x.x` to `v22.x.x` (see `package.json` engines: `>=20.0.0 <23.0.0`, `.nvmrc` pins `20.19.6`)

**If wrong version:**
```bash
nvm use
# or
nvm install 20
```

---

## 3. Network/Routing Checklist

### 3.1 localhost vs 127.0.0.1 vs 0.0.0.0 Bindings

| Binding | Meaning |
|---------|---------|
| `127.0.0.1` | Loopback only, accessible from same machine |
| `localhost` | Resolved by OS, usually maps to 127.0.0.1 or ::1 |
| `0.0.0.0` | All network interfaces (accessible from Docker/VMs) |
| `::1` | IPv6 loopback |

**Check your `/etc/hosts`:**
```bash
cat /etc/hosts | grep localhost
```

**Expected:**
```
127.0.0.1       localhost
::1             localhost
```

---

### 3.2 Port Conflicts

**Find what's using port 4004:**
```bash
lsof -i :4004 -P -n
```

**Kill a conflicting process (Linux/macOS):**
```bash
# Get the PID from lsof output, then:
kill <PID>
```

**Common culprits:**
- Previous crashed `cds watch` process
- Other CAP applications
- Docker containers exposing port 4004

---

### 3.3 Firewall / VPN / Proxy Interference

**Check if firewall is blocking:**
```bash
# macOS
sudo pfctl -s rules 2>/dev/null | grep 4004

# Linux (iptables)
sudo iptables -L -n | grep 4004

# Linux (ufw)
sudo ufw status verbose
```

**Check if VPN is interfering:**
```bash
# See current routes
netstat -rn | head -20

# Check if localhost routes through VPN
traceroute -n 127.0.0.1
```

**Check HTTP proxy settings:**
```bash
echo $HTTP_PROXY $HTTPS_PROXY $http_proxy $https_proxy $NO_PROXY
```

**Fix proxy issues:**
```bash
export NO_PROXY=localhost,127.0.0.1
```

---

### 3.4 Docker/WSL/VM Networking

**If running in Docker:**
```bash
# Check container is running
docker ps | grep cap

# Check port mapping
docker port <container_id>

# Access from host - use host.docker.internal or mapped port
curl http://host.docker.internal:4004/health
```

**If running in WSL2:**
```bash
# Get WSL IP
ip addr show eth0 | grep inet

# From Windows, access via WSL IP or localhost (port forwarding)
curl http://localhost:4004/health
```

**If running in VM:**
- Ensure port forwarding is configured (Host 4004 → Guest 4004)
- Check VM network mode (NAT vs Bridged)

---

### 3.5 Approuter Route Mapping and Destination Config

**Check approuter is using correct config:**
```bash
# Should use xs-app.local.json for local dev
cat approuter/xs-app.local.json
```

**Verify destination URL:**
The `srv-api` destination should point to `http://localhost:4004`:

```json
{
  "name": "srv-api",
  "url": "http://localhost:4004",
  "type": "HTTP"
}
```

**Check approuter environment:**
```bash
# Start approuter and look for destination log
cd approuter && npm start
```

**Expected log:**
```
[approuter] Using local destinations for development: [{"name":"srv-api","url":"http://localhost:4004",...}]
```

---

## 4. Backend-Specific Checklist

### 4.1 Health Endpoint Test

**Always test the health endpoint first:**
```bash
curl -i http://localhost:4004/health
```

**Healthy response:**
```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"healthy","timestamp":"...","checks":{"database":"connected"}}
```

**Unhealthy response:**
```http
HTTP/1.1 503 Service Unavailable

{"status":"unhealthy","checks":{"database":"disconnected"},"error":"..."}
```

---

### 4.2 Environment Variables

**Check if .env exists (optional but recommended):**
```bash
ls -la srv/.env 2>/dev/null || echo "No .env file (using defaults)"
```

**Required for production, optional for dev:**
| Variable | Purpose | Dev Default |
|----------|---------|-------------|
| `NODE_ENV` | Environment mode | `development` |
| `EMPLOYEE_EXPORT_API_KEY` | API key for /api/employees/active | Falls back to `local-dev-api-key` |

**Check current environment:**
```bash
echo "NODE_ENV: ${NODE_ENV:-not set}"
```

---

### 4.3 Database Connection Blocking Startup

**Symptom:** Backend starts but hangs, never reaches "listening" state.

**Test database connectivity separately:**
```bash
# Check if SQLite file is valid
sqlite3 db/sqlite.db "SELECT 1;"
```

**Expected:** `1`

**If corrupted, recreate:**
```bash
npm run deploy:clean
```

---

### 4.4 App Starts But Never Reaches "Listening" State

**Symptom:** `npm run watch --workspace srv` runs but no "server listening" message.

**Causes:**
1. TypeScript compilation errors blocking startup
2. Async initialization code that never resolves
3. Missing database connection

**Debug steps:**
```bash
# 1. Check TypeScript compilation
cd srv && npx tsc --noEmit

# 2. Check for syntax errors
npm run lint --workspace srv

# 3. Start with more verbose output
DEBUG=cds:* npm run watch --workspace srv
```

---

### 4.5 Long-Running Sync Init Code Blocking Event Loop

**Symptom:** Server accepts connection but never responds.

**Test with timeout:**
```bash
curl --max-time 10 http://localhost:4004/health
```

**If timeout:** Check server.ts for blocking synchronous operations during bootstrap.

---

## 5. Approuter-Specific Checklist

### 5.1 Route Definitions and Destination Targets

**Check xs-app.local.json routes:**
```bash
cat approuter/xs-app.local.json
```

**Key routes for backend access:**
```json
{
  "source": "^/odata/v4/?(.*)$",
  "target": "/odata/v4/$1",
  "destination": "srv-api"
}
```

**Verify destination name matches:** The `destination` field must match a destination in `local-start.js` defaults or `default-env.json`.

---

### 5.2 Authentication/Session Middleware Causing Hangs

**For local dev, xs-app.local.json should have:**
```json
{
  "authenticationMethod": "none"
}
```

**If using xs-app.json (production config) locally:**
```json
{
  "authenticationMethod": "route",
  "authenticationType": "ias"
}
```
This will fail locally without IAS binding.

---

### 5.3 Base Paths and Rewriting

**Test approuter rewriting:**
```bash
# Start approuter
cd approuter && npm start &

# Test health endpoint through approuter
curl -v http://localhost:5000/health

# Test OData endpoint through approuter
curl -v 'http://localhost:5000/odata/v4/clients/$metadata'
```

**Common issues:**
| Problem | Solution |
|---------|----------|
| 404 Not Found | Route source pattern doesn't match request path |
| 502 Bad Gateway | Backend not running or destination URL wrong |
| 401 Unauthorized | Authentication required but not configured |

---

### 5.4 Approuter Port Configuration

**Default approuter port:** 5000

**Check/change port:**
```bash
# Set custom port
PORT=5000 npm start
```

**Verify approuter is listening:**
```bash
lsof -i :5000 -P -n
```

---

## 6. Quick Diagnostic Summary

Run these 8-12 commands in order for fastest diagnosis:

```bash
# 1. Check Node version
node --version

# 2. Check dependencies
ls node_modules/@sap/cds >/dev/null && echo "✓ Dependencies OK" || echo "✗ Run: npm install"

# 3. Check database
ls db/sqlite.db >/dev/null && echo "✓ Database OK" || echo "✗ Run: npm run deploy"

# 4. Check if backend is running
lsof -i :4004 -P -n 2>/dev/null | grep LISTEN && echo "✓ Backend listening" || echo "✗ Backend not running"

# 5. Test health endpoint
curl -s -o /dev/null -w "%{http_code}" http://localhost:4004/health | grep -q 200 && echo "✓ Health OK" || echo "✗ Health check failed"

# 6. Check for port conflicts
lsof -i :4004 -P -n

# 7. Check approuter (if using)
lsof -i :5000 -P -n 2>/dev/null | grep LISTEN && echo "✓ Approuter listening" || echo "○ Approuter not running"

# 8. Test through approuter (if running)
curl -s -o /dev/null -w "%{http_code}" http://localhost:5000/health 2>/dev/null | grep -q 200 && echo "✓ Approuter->Backend OK" || echo "○ Approuter test skipped"
```

---

## Getting Help

**With outputs from steps 1-8, the root cause can typically be identified.**

Specifically, provide:
1. Output of `node --version`
2. Output of `ls db/sqlite.db`
3. Output of `lsof -i :4004 -P -n`
4. Output of `curl -v http://localhost:4004/health`
5. First 50 lines of backend startup: `npm run watch --workspace srv 2>&1 | head -50`

---

## Quick Fixes Summary

| Problem | Fix |
|---------|-----|
| Dependencies missing | `npm install && cd approuter && npm install` |
| Database missing | `npm run deploy` |
| Port conflict | `kill <PID>` (get PID from `lsof -i :4004`) |
| Wrong Node version | `nvm use` or `nvm install 20` |
| Backend not started | `npm run watch --workspace srv` |
| Approuter can't reach backend | Ensure backend is running on port 4004 first |
| TypeScript errors | `npm run lint --workspace srv` |
