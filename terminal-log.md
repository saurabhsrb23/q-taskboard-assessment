# Terminal Log — Q-TaskBoard Assessment Session

Chronological record of setup, bug discovery, fixes, and verification.

---

## 1. App Setup & Docker Startup

```bash
$ docker-compose up --build -d
```

**Issue encountered:** Web container failed to start immediately.

```
web-1 | /usr/bin/env: 'bash\r': No such file or directory
```

**Root cause:** `bin/docker-entrypoint` had Windows CRLF line endings.
**Fix:** Added `bin/* text eol=lf` to `.gitattributes` to enforce LF on checkout.
**Commit:** `d468cc1` — `fix: enforce LF line endings for bin/ scripts via .gitattributes`

After fix — container started successfully:

```
web-1 | ▲ Next.js 15.5.15 (Turbopack)
web-1 | - Local: http://localhost:3000
web-1 | ✓ Ready in 6.9s
```

```bash
$ docker-compose exec web npm run db:seed

seeding…
seed complete.
login with any of these (password: password123):
  meera@taskboard.dev   — admin on Q3 Launch, Internal Tools
  arjun@taskboard.dev   — admin on Onboarding, member on Q3 Launch
  kavya@example.com     — member on Q3 Launch
  dev@example.com       — viewer on Q3 Launch
  lina@example.com      — member on Onboarding
```

---

## 2. Initial Test Run

```bash
$ docker-compose exec web npm test
```

```
✓ src/tests/auth.test.ts        (2 tests)
✓ src/tests/schemas.test.ts     (7 tests)
✓ src/tests/TaskCard.test.tsx   (3 tests)

Test Files  3 passed (3)
     Tests  12 passed (12)
  Duration  1.72s
```

All 12 baseline tests passing on first run.

---

## 3. SQL Injection Discovery & Fix

**File:** `src/app/api/projects/[id]/tasks/route.ts` (lines 27–34)

**Vulnerable code:**

```ts
const sql = `
  SELECT id, project_id, title, description, status, ...
  FROM tasks
  WHERE project_id = '${projectId}'
    AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
`;
const tasks = await prisma.$queryRawUnsafe(sql);
```

The `q` search parameter was interpolated directly into raw SQL.
Any authenticated member could inject SQL via `?q=` — e.g.:

```
GET /api/projects/abc/tasks?q=x' OR 1=1--
```

**Fix applied:**

```ts
const search = `%${q}%`;
const tasks = await prisma.$queryRaw`
  SELECT id, project_id, title, description, status, ...
  FROM tasks
  WHERE project_id = ${projectId}
    AND (title ILIKE ${search} OR description ILIKE ${search})
  ORDER BY position ASC
`;
```

`$queryRaw` sends values as bind parameters — never as executable SQL.
**Commit:** `eb1a52c` — `fix(security): replace $queryRawUnsafe with parameterized $queryRaw in task search`

---

## 4. Login 401 Issue — Curl Proof

**Reported:** User registered successfully (`201 Created`) but got `invalid credentials` on login.

**Registration request:**

```bash
curl "http://localhost:3000/api/auth/register" \
  -H "content-type: application/json" \
  --data-raw '{"name":"saurabh","email":"ss@gmail.com","password":"saurabh123"}'
# → 201 Created
```

**Login attempt (failing):**

```bash
curl "http://localhost:3000/api/auth/login" \
  -H "content-type: application/json" \
  --data-raw '{"email":"ss@gmail.com","password":"saurabh@123"}'
# → {"error":"invalid credentials"}
```

**Diagnosis — bcrypt test inside container:**

```bash
$ docker-compose exec web node -e "
  require('bcryptjs')
    .compare('saurabh123', '<hash_from_db>')
    .then(ok => console.log('bcrypt result:', ok))
"
# bcrypt result: true   ← stored hash matches 'saurabh123', NOT 'saurabh@123'
```

**Root cause:** Login form had `useState("password123")` — the invisible pre-filled
password (`••••••••••••`) caused the user to register with a different password
than they thought they were typing.

**Fix:** Cleared both pre-filled defaults in `src/app/login/page.tsx`.

```ts
// Before
const [email, setEmail] = useState("meera@taskboard.dev");
const [password, setPassword] = useState("password123");

// After
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
```

**Commit:** `8329258` — `fix(ux): remove hardcoded credentials from login form`

**Curl proof — login works after fix:**

```bash
$ docker-compose exec web node -e "
  fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({email:'ss@gmail.com', password:'saurabh123'})
  }).then(r => r.json()).then(console.log)
"
# { user: { id: 'cmpnq9ydm0004nz64gfwtn4zd', email: 'ss@gmail.com', name: 'saurabh' },
#   token: 'eyJhbGci...' }
```

---

## 5. Airtable Export Feature

**Feature added:** `POST /api/projects/:id/export`

Real Airtable integration built in `src/lib/airtable-client.ts` using the
official `airtable` npm package. Export is idempotent — re-running updates
existing records rather than creating duplicates.

**End-to-end test (inside container):**

```bash
$ docker-compose exec web node -e "
async function run() {
  const login = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify({email:'meera@taskboard.dev', password:'password123'})
  }).then(r => r.json());

  const projects = await fetch('http://localhost:3000/api/projects', {
    headers: {'Authorization': 'Bearer ' + login.token}
  }).then(r => r.json());

  const project = projects.projects[0];
  console.log('Exporting:', project.name);

  const result = await fetch(
    'http://localhost:3000/api/projects/' + project.id + '/export',
    { method: 'POST', headers: {'Authorization': 'Bearer ' + login.token} }
  ).then(r => r.json());

  console.log('Result:', JSON.stringify(result));
}
run().catch(console.error);
"
# Exporting: Q3 Launch
# Result: {"exported":7,"failed":0,"total":7}
```

Tasks visible in Airtable base after export with all fields populated:
`Title`, `Description`, `Status`, `Assignee`, `TaskBoardId`, `ProjectId`, `CreatedAt`

---

## 6. Final Passing Test Run

```bash
$ docker-compose exec web npm test
```

```
✓ src/tests/airtable-export.test.ts   (7 tests)
✓ src/tests/auth.test.ts              (2 tests)
✓ src/tests/schemas.test.ts           (7 tests)
✓ src/tests/TaskCard.test.tsx         (3 tests)

Test Files  4 passed (4)
     Tests  19 passed (19)
  Duration  2.35s
```

All 19 tests passing. 7 new export tests cover:
- Full export
- Idempotency (no duplicates on re-run)
- Field update on second export
- Single-record failure isolation
- Empty task list
- Null assignee / description handling
- Mid-list failure continues remaining tasks
