# Deploying Pitcher's Showdown

| Part | Folder | Host | Production URL |
|---|---|---|---|
| API (Express + Mongoose) | `server/` | Render web service | `https://pitchers-showdown.onrender.com` |
| Website + admin console (React + Vite) | `client/` | Vercel | `https://pitchers-showdown.vercel.app` |
| Database | — | MongoDB Atlas | connection string in Render only |

The player site and the admin console are the same Vercel app. The admin console lives at `/admin` and is not linked from the player pages. Hiding the link is not the protection: every `/api/admin/*` route checks a separate admin login on the server.

> **Current blockers (as of this guide):**
> 1. The Render service is suspended. Every request returns `503` with the header `x-render-routing: suspend-by-user`, and the browser reports it as "could not reach the API / CORS". Resume it from the Render account that owns it (Step 3.1).
> 2. Credentials were committed to this public repo in the past. Old commits contain `server/.env` with an Atlas database user and a player `JWT_SECRET`. Rotate both before going live (Step 2.3 and Step 3.4).

---

## Environment variables (reference)

### Render (server): secrets live here and nowhere else

| Variable | Required | Read in | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | `server/models/init.js` | Atlas connection string. The server exits at startup if it is missing. |
| `JWT_SECRET` | yes | `server/controllers/authController.js`, `server/middleware/middleware.js` | Signs player (team) login tokens. The server exits at startup if it is missing. |
| `ADMIN_USERNAME` | for `/admin` | `server/middleware/adminAuth.js` | Admin login name |
| `ADMIN_PASSWORD_HASH` | for `/admin` | same | bcrypt hash of the admin password (never the password itself) |
| `ADMIN_JWT_SECRET` | for `/admin` | same | Signs admin tokens. Must be different from `JWT_SECRET`. |
| `CORS_ORIGINS` | strongly recommended | `server/app.js` | Comma-separated list of allowed browser origins, e.g. `https://pitchers-showdown.vercel.app`. **If empty, any origin is allowed.** |
| `ALLOW_PUBLIC_REGISTRATION` | no | `server/controllers/authController.js` | Only the exact value `true` enables `POST /api/auth/register`. Leave it unset. |
| `PORT` | no | `server/server.js` | Render sets it automatically. Do not add it yourself. |

If any of the three `ADMIN_*` variables is missing, the site still works for players. Every admin endpoint then answers `503 "Admin access is not configured"`, and startup prints a warning.

### Vercel (client): public values only

| Variable | Value | Purpose |
|---|---|---|
| `VITE_API_URL` | `https://pitchers-showdown.onrender.com` | API base URL, read in `client/lib/config.js` |

Every `VITE_*` value is compiled into the JavaScript that anyone can download. **Never put a password, hash, database URL or JWT secret in Vercel.** If `VITE_API_URL` is unset, the code falls back to `https://pitchers-showdown.onrender.com`.

---

## Step 1: Pre-deployment preparation

1. **Branch and working tree**
   ```bash
   git status            # on main; review every modified/untracked file
   git fetch origin
   git status -sb        # if "behind", run: git pull --ff-only
   ```
   At the time of writing, `origin/main` is two commits ahead of the local `main`, but those commits contain the same files, so the pull is conflict-free.

2. **Files that must be committed.** All of `server/` and `client/` except ignored files:
   - Server: `app.js`, `server.js`, `services/`, `routes/adminRoutes.js`, `controllers/adminController.js`, `middleware/adminAuth.js`, `middleware/rateLimit.js`, `models/admin.js`, `lib/hashAdminPassword.js`, `test/`, `.env.example`, `package.json`, `package-lock.json`, plus the modified controllers and models.
   - Client: `lib/config.js`, `src/admin/`, `package-lock.json`, plus the modified pages.
   - Root: `.gitignore`, `DEPLOYMENT.md`.

3. **Confirm no secrets are included**
   ```bash
   git check-ignore -v server/.env client/.env.local   # both must print a matching rule
   git add -A && git status                          # .env, .env.local, dist/, node_modules/ must NOT appear
   git diff --cached | grep -inE 'mongodb(\+srv)?://[^ <]*:[^ <]*@|\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{20}|_SECRET=[^ ]{8}' | grep -v 'USER:PASSWORD@' && echo "STOP: secret staged"
   ```
   Only `server/.env.example`, which holds placeholders, may be committed.

4. **Run the checks**
   ```bash
   cd server
   npm ci
   npm test           # uses an in-memory MongoDB (first run downloads a MongoDB binary)
   # or, faster, against a throwaway database on a NON-production cluster:
   # TEST_DATABASE_URL="<dev cluster url>" npm test
   #   -> creates pitchers_test_<random>, drops it afterwards, refuses to drop anything else

   cd ../client
   npm ci
   npm run lint
   VITE_API_URL=https://pitchers-showdown.onrender.com npm run build
   ```
   Never point `TEST_DATABASE_URL` at the production cluster.

5. **Known outstanding items.** See "Remaining risks" at the end.

---

## Step 2: MongoDB Atlas

### 2.1 Cluster
Use the existing production cluster that holds the real teams and investments. Do not create a new empty one, and do not reset or drop anything.

> **Database name matters.** If the connection string has no `/<dbname>` before the `?`, MongoDB uses the database called `test`. The production data probably lives there. **Do not add or change the database name in `DATABASE_URL`** unless you have deliberately moved the data, or the app will start against an empty database. After deploying, the Render log line `Connected to MongoDB (database: …)` tells you which database is in use.

### 2.2 Database user
Atlas → **Database Access** → **Add New Database User**:
- Authentication: Password. Use a long random password (Atlas can generate one).
- Privileges: **Built-in Role → "Read and write to any database"**, or, narrower, a custom role with `readWrite` on the production database only.
- Do not give the app an Atlas admin role.

### 2.3 Rotate the leaked user (required)
The database user in the old `server/.env` commits is public.
1. Create the new user (2.2) and put its connection string in Render (Step 3).
2. Deploy and confirm `/api/health` returns `ok`.
3. Then **delete or change the password of the old user** in Database Access.

Removing the file from Git history does not help: the repo is public and forks or clones may already have it. Rotation is the fix.

### 2.4 Network access
Atlas → **Network Access**:
- **`0.0.0.0/0`** (allow from anywhere) is the simplest, and is needed if the Render plan has no fixed outbound IPs. The risk is that anyone holding the connection string can reach the cluster, so security rests entirely on the user password and TLS. Use a strong password and least privilege.
- **Narrower:** Render lists the service's outbound IP ranges under the service's **Connect → Outbound** tab. Add those ranges instead of `0.0.0.0/0`, plus your own IP when you need local access.

### 2.5 Connection string
Atlas → **Connect** → **Drivers** → copy the `mongodb+srv://…` string and insert the user's password.
- If the password contains special characters (`@ : / ? # [ ] %`), URL-encode it:
  ```bash
  node -e "console.log(encodeURIComponent(process.argv[1]))" 'the-password'
  ```
  (Run it in a private terminal; it appears in your shell history.)
- Keep the database part exactly as production uses it now (see 2.1).

### 2.6 Verify connectivity without exposing the string
After deploying (Step 3), check:
```bash
curl https://pitchers-showdown.onrender.com/api/health
# {"status":"ok","database":"connected"}  -> DB reachable
# 503 {"status":"unavailable",...}         -> app running, DB not connected
```
The Render log shows `Connected to MongoDB (database: <name>)` or `Error connecting to MongoDB: <message>`. Only the message is printed, never the URL.

### 2.7 Keep development separate
Local `server/.env` should point at a different cluster or database from production. Test runs only touch throwaway `pitchers_test_*` databases.

---

## Step 3: Deploy the backend to Render

### 3.1 Service
If the service already exists (`pitchers-showdown.onrender.com`), open it in the Render account that owns it and click **Resume Service**. Otherwise **New → Web Service** and connect the GitHub repo that Render should deploy from (`GryffinX/Pitchers-Showdown` or the `ecell-vitc` upstream).

| Setting | Value |
|---|---|
| Runtime | Node |
| Branch | `main` |
| Root Directory | `server` |
| Build Command | `npm ci` (or `npm install`) |
| Start Command | `npm start` (runs `node server.js`) |
| Health Check Path | `/api/health` |
| Auto-Deploy | On commit (optional) |

Do not use `npm run dev` on Render: it expects a local `.env` file.

### 3.2 Environment variables
Service → **Environment** → add the variables from the reference table: `DATABASE_URL`, `JWT_SECRET`, the three `ADMIN_*` (Step 4), and `CORS_ORIGINS=https://pitchers-showdown.vercel.app`. Do **not** add `PORT`. Leave `ALLOW_PUBLIC_REGISTRATION` unset.

### 3.3 Generate secrets locally
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run once for JWT_SECRET
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"   # run again for ADMIN_JWT_SECRET
```
Paste each straight into Render. Don't save them in files or chat.

### 3.4 Rotate `JWT_SECRET` (required)
The old player `JWT_SECRET` is in public Git history, so use a newly generated one. All players are signed out once and simply log in again. Balances and investments are unaffected.

### 3.5 Deploy and read the logs
Save the variables; Render redeploys. In **Logs**, a healthy start looks like:
```
Server is running on port 10000
Connected to MongoDB (database: test)
```
| Log line | Meaning / fix |
|---|---|
| `Missing required environment variable(s): …` | Add the named variable. The service exits until you do. |
| `Error connecting to MongoDB: bad auth …` | Wrong user or password, or the password isn't URL-encoded. |
| `Error connecting to MongoDB: … timed out / ENOTFOUND` | Atlas Network Access is blocking Render, or the host is wrong. |
| `Admin dashboard disabled: set ADMIN_USERNAME, …` | Players work; add the admin variables (Step 4). |
| `ADMIN_JWT_SECRET should be different from JWT_SECRET` | Generate a separate admin secret. |
| Build fails on `bcrypt` | Clear the build cache and redeploy; make sure the runtime is Node 18 or newer. |

### 3.6 Verify from your terminal
```bash
API=https://pitchers-showdown.onrender.com
curl -i $API/api/health                                  # 200 {"status":"ok",...}
curl -i -X POST $API/api/admin/login -H 'Content-Type: application/json' -d '{}'
#   400 "Username and password are required" -> admin route deployed and configured
#   503 "Admin access is not configured"     -> ADMIN_* variables missing
#   404                                      -> old code deployed (admin routes not present)
curl -i -X POST $API/api/auth/register -H 'Content-Type: application/json' -d '{}'
#   403 "Public registration is disabled"    -> correct default
```
On the free plan, the first request after idle can take about a minute while the service wakes.

---

## Step 4: Configure the production administrator

1. **Choose a password** of at least 12 characters (16 or more random characters is better). Store it in a password manager.
2. **Hash it locally** with the project's helper:
   ```bash
   cd server
   npm run hash-admin-password
   ```
   It prompts twice without echoing, rejects anything shorter than 12 characters, and prints one line, `ADMIN_PASSWORD_HASH=$2b$12$…` (bcrypt, cost 12). Nothing is written to disk. Copy only the value after `=`.
3. **Generate `ADMIN_JWT_SECRET`** with the command in 3.3. It must differ from `JWT_SECRET`.
4. **In Render → Environment:**
   - `ADMIN_USERNAME` = your chosen login name
   - `ADMIN_PASSWORD_HASH` = the `$2b$12$…` value, pasted as-is with no quotes (Render stores it literally)
   - `ADMIN_JWT_SECRET` = the generated secret

   Save; Render redeploys automatically. If it doesn't, use **Manual Deploy → Deploy latest commit**.
5. **Log in** at `https://pitchers-showdown.vercel.app/admin`. Sessions last 2 hours and are kept per browser tab.
6. **If the API answers `503 "Admin access is not configured"`**, one of the three variables is empty or misspelled. Fix it and redeploy.
7. **Rotating credentials:**
   - *Password:* generate a new hash (step 2), replace `ADMIN_PASSWORD_HASH`, and redeploy. Existing admin sessions stay valid until they expire (at most 2 hours).
   - *Sign everyone out now:* replace `ADMIN_JWT_SECRET` too. Every existing admin token is rejected immediately.
   - Changing `ADMIN_USERNAME` also invalidates existing admin tokens.

Wrong passwords never lock the admin account, but more than 10 login attempts from one IP within 15 minutes get `429 Too many login attempts`. The counter resets when the service restarts.

---

## Step 5: Deploy the frontend to Vercel

1. Vercel → **Add New → Project** → import the GitHub repo (or open the existing `pitchers-showdown` project).
2. Settings:

   | Setting | Value |
   |---|---|
   | Root Directory | `client` |
   | Framework Preset | Vite |
   | Install Command | `npm install` (default) |
   | Build Command | `npm run build` (runs `vite build`) |
   | Output Directory | `dist` |

3. **Environment Variables:** `VITE_API_URL` = `https://pitchers-showdown.onrender.com` (no trailing slash needed; one is stripped anyway), scoped to **Production** and **Preview**.
4. **Deploy.** Vite bakes `VITE_API_URL` into the bundle at build time, so after changing it you must **Redeploy**. A new value has no effect on an existing build.
5. **Direct links:** `client/vercel.json` rewrites every path to `index.html`, so refreshing `/admin`, `/admin/teams`, `/login` or `/teams` works. Open `https://pitchers-showdown.vercel.app/admin` directly and confirm the sign-in card appears.
6. The real production origin is shown under Vercel → **Domains**. Use that exact value in `CORS_ORIGINS`.

---

## Step 6: Connect Vercel and Render

1. Render → `CORS_ORIGINS=https://pitchers-showdown.vercel.app`, with no path. A trailing slash is tolerated.
   - Several origins: `CORS_ORIGINS=https://pitchers-showdown.vercel.app,https://your-custom-domain.com`
   - Each Vercel preview URL is a different origin. Add a specific preview URL only while you need it.
2. Save, so Render redeploys. Vercel doesn't need a redeploy for a CORS change.
3. If the Vercel domain changes, update `CORS_ORIGINS`. If the API URL changes, update `VITE_API_URL` **and redeploy Vercel**.

Auth uses request headers (`x-access-token` for players, `Authorization: Bearer` for admins), not cookies, so credentialed CORS is never needed. Don't enable it.

### Diagnosing errors (browser DevTools → Network)

| What you see | Cause | Fix |
|---|---|---|
| "Could not reach the API at … (CORS)" / `net::ERR_FAILED` / CORS error | API down or suspended (a `503` with no CORS headers), cold start, or origin not in `CORS_ORIGINS` | `curl -i $API/api/health`; check the `x-render-routing` header (`suspend-by-user` = resume the service); compare `CORS_ORIGINS` with the page's exact origin |
| `ERR_NAME_NOT_RESOLVED` | Wrong `VITE_API_URL` host | Fix the variable, redeploy Vercel |
| Request goes to the wrong host | Stale build | Redeploy Vercel after setting `VITE_API_URL` |
| Long wait, then success | Free-plan cold start | Expected; upgrade the plan to avoid it |
| `401` on admin login | Wrong username or password, or the hash doesn't match | Re-hash the password and update `ADMIN_PASSWORD_HASH` |
| `401` "Admin session expired / has ended" | 2-hour expiry or logout | Sign in again |
| `403` on player requests | Session replaced by a newer login, password reset, or team deleted | Log in again |
| `404` on `/api/admin/*` | Render runs old code | Deploy the latest commit |
| `429` | Admin login rate limit | Wait 15 minutes |
| `500` | Server error; details are in Render Logs only | Read the logs |
| `503` "Admin access is not configured" | `ADMIN_*` variable missing | Step 4 |
| `503` from `/api/health` | Database not connected | Step 2 / 3.5 |

---

## Step 7: Final smoke tests

Run these against production after every deploy. Use a team that exists for testing, or ask before creating, resetting or deleting real teams.

- [ ] `GET /api/health` → `200 {"status":"ok","database":"connected"}`
- [ ] `POST /api/auth/register` → `403` (registration closed)
- [ ] `/admin` loads directly and after a refresh; DevTools shows the login request going to `https://pitchers-showdown.onrender.com/api/admin/login`
- [ ] Wrong admin password → "Invalid admin credentials" (not a network error)
- [ ] Correct admin login → Overview shows the real team count, total invested and unspent balance
- [ ] Opening `https://pitchers-showdown.onrender.com/api/admin/stats` in a new tab without a token → `401`
- [ ] Teams page: list, search, sort and pagination work
- [ ] Create a team → its credentials work on the player `/login` page
- [ ] Rename the team → the new name appears on the player Teams page
- [ ] Reset its password → the old password fails, the new one works, and an already-open player session is signed out
- [ ] Player investment: log in as a team, invest in another team, and the purse goes down; investing again in the same team is refused; investing more than the purse is refused
- [ ] Profile shows the investment; scores and history still show existing data
- [ ] Delete a test team (type the username to confirm) → it can't log in and disappears from the player Teams list; its investments still count in the Overview
- [ ] Log out → "Signed out", and the back button or a refresh returns to the sign-in page
- [ ] DevTools Console has no red errors; Network has no failed requests besides the deliberate ones above

The audit log feature was removed at the owner's request: admin actions are not recorded. The only server output is startup messages and errors.

---

## Step 8: Maintenance and rollback

- **Rotate admin credentials:** Step 4.7. **Rotate the player `JWT_SECRET`:** replace it in Render and redeploy; all players re-login.
- **Change environment variables safely:** edit in Render or Vercel, save, and watch the deploy. Render keeps the previous deploy serving until the new one passes `/api/health`. Never commit `.env` files; `server/.env.example` documents the keys.
- **Logs:** Render → service → **Logs** (startup messages and errors only). Vercel → project → **Deployments → (deploy) → Build Logs**.
- **Roll back the API:** Render → **Events/Deploys** → pick the last good deploy → **Rollback**. Environment variables are not rolled back; revert them by hand if needed.
- **Roll back the website:** Vercel → **Deployments** → the last good one → **Promote to Production** (Instant Rollback).
- **Back up MongoDB** before events and before risky deploys. The free M0 tier has no automatic cloud backups. Install MongoDB Database Tools, then:
  ```bash
  # put the connection string in an env var instead of on the command line
  read -s MONGO_URI && export MONGO_URI
  mongodump --uri="$MONGO_URI" --out="backup-$(date +%F)"
  # restore only into a NEW/empty database, then compare, never over live data blindly:
  # mongorestore --uri="$OTHER_URI" backup-YYYY-MM-DD
  ```
- **Recover from a bad deploy without touching data:** roll back the service (above). Code changes in this repo never delete data. Teams are soft-deleted (`deletedAt`), investments are never removed, and a deleted team can be restored by clearing `deletedAt` in Atlas Data Explorer.
- **API URL changes:** update `VITE_API_URL` in Vercel and redeploy. If the frontend domain changes, update `CORS_ORIGINS` in Render.

---

## Remaining risks

- **Leaked credentials** in public Git history: the Atlas user and the old `JWT_SECRET`. Rotate both (Steps 2.3 and 3.4).
- **`npm audit`** still reports `tar` via `bcrypt@5` → `@mapbox/node-pre-gyp`. It is only used while installing bcrypt's prebuilt binary, not at runtime. The fix is upgrading to `bcrypt@6`, a major version, so test it separately before switching.
- **Duplicate investment race:** two simultaneous investments from the same team into the *same* other team could both be accepted. The purse itself can't go negative, because that check is atomic. A unique index on `Investment {user, pitcher}` would close this, but should only be added after confirming production has no duplicates.
- **Rate limiting is per Render instance and in memory.** It's fine on one instance and resets on restart.
- **Free-plan cold starts** can make the first request take about a minute.
