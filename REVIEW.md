# REVIEW.md — Security & Quality Findings

> Findings from the Q-TaskBoard assessment review.
> Severity: **HIGH** → **MEDIUM** → **LOW**

---

## 1. [HIGH] SQL Injection via Unsanitised Search Parameter

**Status:** ✅ Fixed (`eb1a52c`)
**Affected file:** `src/app/api/projects/[id]/tasks/route.ts`
**Line reference:** Line 27–34 (original)

### Description
The `GET /api/projects/:id/tasks?q=` endpoint built raw SQL using `$queryRawUnsafe` and interpolated the user-supplied `q` parameter directly into the query string without any escaping or parameterisation.

```ts
// VULNERABLE (original)
const sql = `
  SELECT ... FROM tasks
  WHERE project_id = '${projectId}'
    AND (title ILIKE '%${q}%' OR description ILIKE '%${q}%')
`;
const tasks = await prisma.$queryRawUnsafe(sql);
```

### Business Impact
Any authenticated project member could inject arbitrary SQL via the search field. Exploits range from data exfiltration (reading all users, tokens, hashed passwords) to data destruction (`DROP TABLE`) and lateral movement across all projects. A single compromised or malicious member could impact the entire database.

### Recommended Fix
Use `prisma.$queryRaw` with tagged template literals so the database driver binds values as parameters — never as SQL.

```ts
// FIXED
const search = `%${q}%`;
const tasks = await prisma.$queryRaw`
  SELECT ... FROM tasks
  WHERE project_id = ${projectId}
    AND (title ILIKE ${search} OR description ILIKE ${search})
  ORDER BY position ASC
`;
```

---

## 2. [MEDIUM] Missing Authorisation Check on Task PATCH

**Status:** ✅ Fixed (`dev` branch, this session)
**Affected file:** `src/app/api/tasks/[id]/route.ts`
**Line reference:** Line 16–38 (original PATCH handler)

### Description
The `PATCH /api/tasks/:id` endpoint verified the JWT (confirmed the user was logged in) but did not check whether the user was a member of the task's project or had a role that permits editing. The `DELETE` handler in the same file already had the correct check; `PATCH` was missing it.

```ts
// VULNERABLE (original) — no membership check before update
const existing = await prisma.task.findUnique({ where: { id } });
if (!existing) return notFound("task not found");
// jumped straight to prisma.task.update() — no role check
```

### Business Impact
Any valid JWT holder (including members of completely unrelated projects) could update the title, description, status, assignee, or position of any task in the system by knowing or guessing a task ID (cuid). This would allow cross-project data tampering without leaving any audit trail.

### Recommended Fix
After fetching the task, verify membership and role — mirroring what `DELETE` already does.

```ts
const membership = await getProjectMembership(user.id, existing.projectId);
if (!membership) return forbidden("you are not a member of this project");
if (!canEditTasks(membership.role)) return forbidden("viewers cannot edit tasks");
```

---

## 3. [MEDIUM] Airtable Integration Was Mocked — Real API Never Called

**Status:** ✅ Fixed (`b6bf385`)
**Affected file:** `src/lib/airtable-mock.ts` (mock only), `src/lib/airtable-client.ts` (new)
**Line reference:** N/A — the integration was entirely absent

### Description
The `airtable` npm package was installed and environment variables (`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`) were defined in `.env.example`, but no production code ever called the real Airtable API. `airtable-mock.ts` was used as if it were a real integration.

### Business Impact
The export feature promised by the product spec did not function. Data could not be synced to Airtable for external reporting, client handoffs, or cross-tool workflows. Any team relying on the export would silently receive no data.

### Recommended Fix
Implement a real Airtable client (`src/lib/airtable-client.ts`) using the official SDK with:
- Idempotent upsert via a `TaskBoardId` lookup field (no duplicates on re-run)
- Per-record retry for transient errors (429, 5xx) with exponential backoff
- Per-record error isolation so one failure does not abort the rest

---

## 4. [LOW] Hardcoded Demo Credentials in Login Form

**Status:** ✅ Fixed (`8329258`)
**Affected file:** `src/app/login/page.tsx`
**Line reference:** Lines 10–11 (original)

### Description
The login form initialised both `email` and `password` state with real seed account credentials (`meera@taskboard.dev` / `password123`). The password field rendered as `••••••••••••` (invisible), making it impossible for users to know a value was already present.

```ts
// VULNERABLE (original)
const [email, setEmail] = useState("meera@taskboard.dev");
const [password, setPassword] = useState("password123");
```

### Business Impact
Newly registered users who navigated to the login page after registration could not log in with their own credentials. The invisible pre-filled password caused them to submit the wrong value — either the default `password123` alone, or their own password appended to it. This was the root cause of the `invalid credentials` 401 errors reported during testing. In production, it would expose a seed account's credentials to any observer of the page source or network traffic.

### Recommended Fix
Clear both default values so the form is blank on load.

```ts
const [email, setEmail] = useState("");
const [password, setPassword] = useState("");
```

---

## Summary Table

| # | Severity | Issue | File | Status |
|---|---|---|---|---|
| 1 | HIGH | SQL injection via `$queryRawUnsafe` | `api/projects/[id]/tasks/route.ts` | ✅ Fixed |
| 2 | MEDIUM | Missing auth check on task PATCH | `api/tasks/[id]/route.ts` | ✅ Fixed |
| 3 | MEDIUM | Airtable integration mocked, not real | `lib/airtable-mock.ts` | ✅ Fixed |
| 4 | LOW | Hardcoded credentials in login form | `app/login/page.tsx` | ✅ Fixed |
