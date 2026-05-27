# CLAUDE.md — Q-TaskBoard Assessment

## Project Overview

Full-stack task/kanban board built with:
- **Frontend:** Next.js 15 (App Router), React 19, TypeScript 5 (strict), TanStack Query 5, Tailwind CSS 3
- **Backend:** Next.js API Routes (REST), Prisma 6 ORM, PostgreSQL 16
- **Auth:** JWT (30-day expiry, stored in `localStorage`), bcryptjs password hashing
- **Validation:** Zod 3 at all API boundaries
- **Testing:** Vitest 2 + React Testing Library

---

## Behaviour Guidelines

### Before Making Changes
- Explain the issue and the plan before touching any code
- List all affected files upfront
- Keep solutions simple and production-ready
- Avoid unnecessary refactors — fix only what is asked

### While Coding
- Debug step by step; do not jump to conclusions
- Briefly explain each code change as it is made
- Do not modify seed data (`prisma/seed.ts`)

### After Implementation
- Summarize what was completed
- List files changed and why

### Commits and Pushes
- Ask for a commit message before committing — never commit silently
- Ask for explicit approval before pushing to GitHub
- Never use `--no-verify` to skip hooks

---

## Project Structure

```
src/
  app/
    api/
      auth/login/route.ts         # POST — login, returns JWT
      auth/register/route.ts      # POST — register, returns JWT
      projects/route.ts           # GET (list), POST (create)
      projects/[id]/route.ts      # GET, PATCH, DELETE — project detail
      projects/[id]/tasks/route.ts # GET (search), POST (create task)
      tasks/[id]/route.ts         # PATCH, DELETE — task update/delete
      users/me/route.ts           # GET — current user
    dashboard/page.tsx            # Project list (authenticated)
    projects/[id]/page.tsx        # Kanban board
    login/page.tsx
    register/page.tsx
  components/
    Header.tsx
    QueryProvider.tsx
    StatusColumn.tsx
    TaskCard.tsx
    TaskDetail.tsx
  lib/
    auth.ts                       # getCurrentUser(), canEditProject(), canEditTasks()
    jwt.ts                        # signToken(), verifyToken()
    prisma.ts                     # Prisma client singleton
    api-client.ts                 # Frontend fetch wrapper (reads token from localStorage)
    airtable-mock.ts              # Mock Airtable client — NOT real integration
  schemas/
    auth.ts / task.ts / project.ts
  types/index.ts
prisma/
  schema.prisma                   # 4 models: User, Project, Membership, Task
  seed.ts                         # DO NOT MODIFY
  migrations/
```

---

## Auth and Permissions

**Flow:**
1. Client sends `Authorization: Bearer <token>` header
2. `getCurrentUser()` in `src/lib/auth.ts` verifies JWT and fetches user from DB
3. Routes return `401` if user is missing

**Roles (per project):**
- `admin` — full access: edit project, manage tasks
- `member` — create/edit/delete tasks only
- `viewer` — read-only

**Helpers:**
- `canEditProject(role)` → `role === "admin"`
- `canEditTasks(role)` → `role === "admin" || role === "member"`

---

## Seed Data (DO NOT MODIFY)

File: `prisma/seed.ts`

| Email | Name | Password |
|---|---|---|
| meera@taskboard.dev | Meera Iyer | password123 |
| arjun@taskboard.dev | Arjun Rao | password123 |
| kavya@example.com | Kavya Reddy | password123 |
| dev@example.com | Dev Sharma | password123 |
| lina@example.com | Lina Joshi | password123 |

**3 Projects:** Q3 Launch, Customer Onboarding Revamp, Internal Tools Cleanup
**12 Tasks** distributed across todo / in_progress / review / done

Reset seed: `npm run db:reset`

---

## Known Issues and Risky Areas

### HIGH — SQL Injection
**File:** `src/app/api/projects/[id]/tasks/route.ts`

The `q` search parameter is interpolated directly into `$queryRawUnsafe` without sanitization. Any authenticated project member can exploit this.

**Fix:** Replace with `prisma.$queryRaw` using tagged template literals (parameterized).

### MEDIUM — Missing Authorization on Task PATCH/DELETE
**File:** `src/app/api/tasks/[id]/route.ts`

JWT is verified but project membership is never checked. A valid user can update or delete any task in the system by guessing a task ID.

**Fix:** After fetching the task, verify the user has a `Membership` record for `task.projectId` with a sufficient role.

### MEDIUM — Airtable Integration is Mocked
**File:** `src/lib/airtable-mock.ts`

The Airtable SDK is installed and environment variables are referenced, but only a mock client is used. The real API integration is not implemented.

### LOW — Hardcoded Credentials in Login Form
**File:** `src/app/login/page.tsx`

Default form values are pre-filled with test credentials. Safe for assessment; must be removed for production.

### LOW — No Rate Limiting on Auth Routes
`/api/auth/login` and `/api/auth/register` have no brute-force protection.

### LOW — JWT in localStorage
Tokens stored in `localStorage` are accessible to JavaScript, making them XSS-vulnerable if the app is ever compromised.

### LOW — No Pagination
`/api/projects` and `/api/projects/:id/tasks` return all records with no limit/offset.

---

## Review Focus Checklist

When reviewing code changes, check:

- [ ] Auth: Is `getCurrentUser()` called and the result checked before proceeding?
- [ ] Permissions: Is the user's role verified against `canEditProject` / `canEditTasks` before mutating?
- [ ] SQL: Are all raw queries using `prisma.$queryRaw` (parameterized), never `$queryRawUnsafe` with interpolation?
- [ ] Validation: Is Zod schema parsing used at the API boundary before trusting input?
- [ ] Data integrity: Do task updates include a membership check for the task's project?
- [ ] Seed data: Is `prisma/seed.ts` unchanged?

---

## Development Setup

```bash
# Docker (recommended)
docker-compose up --build
docker-compose exec web npm run db:seed

# Manual
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run db:seed
npm run dev
```

**Required env vars:** `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV`
**Optional (Airtable):** `AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_NAME`

**Scripts:**
- `npm run dev` — Start dev server (port 3000, Turbopack)
- `npm test` — Run Vitest tests
- `npm run typecheck` — TypeScript type check
- `npm run db:seed` — Run seed
- `npm run db:reset` — Wipe DB and re-seed

---

## Pre-commit Hook Note

A `.git-hooks/pre-commit` script is active. It captures AI tool conversation logs (`.claude/`, `.cursor/`, etc.) into `.ai-conversations/` and stages them automatically. This is part of the Ajackus evaluation process — do not disable it.

---

## REVIEW.md Tracking

Track all findings in `REVIEW.md` with this format:

```
## [Severity] — [Area]
**File:** path/to/file.ts:line
**Issue:** Description
**Impact:** What can go wrong
**Fix:** Recommended resolution
**Status:** open | in-progress | resolved
```
