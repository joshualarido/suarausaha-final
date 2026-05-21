# SuaraUsaha Backend

## Supabase Dev Setup (Supabase-Only DB)

This backend uses:

- Better Auth for authentication
- Native PostgreSQL access (`kysely` + `pg`)
- Supabase as hosted PostgreSQL (no Supabase Auth migration in MVP)

### 1) Create Supabase project

1. Create a new project (suggested name: `suarausaha-dev`).
2. Choose region close to Indonesia (usually Singapore).
3. Save the DB password in your password manager.

### 2) Collect required Supabase values

From Supabase Dashboard:

1. `Project Settings -> Database -> Connection string (Direct)`
2. `Project Settings -> Database -> Connection string (Transaction pooler)` (optional, future use)
3. `Project Settings -> API -> Project URL`
4. `Project Settings -> API -> anon key` (optional for now)
5. `Project Settings -> API -> service_role key` (optional for now)

### 3) Configure backend env

Update `backend/.env`:

- `DATABASE_URL`: use Supabase direct Postgres URL with `sslmode=require`
- `API_BASE_URL`: backend public URL for Better Auth callbacks
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

If your connection string does not include SSL mode, append `?sslmode=require`.

### 4) Google OAuth callback

In Google Cloud Console, add callback URL used by Better Auth.

For local backend example:

- `http://localhost:3000/api/auth/callback/google`

### 5) Apply schema and run

From `backend/`:

1. `npm run build`
2. `npm run dev`

Schema bootstrap is automatic on backend startup. It creates required auth/business tables if missing.

### 6) Validate auth + persistence

1. Login via Google OAuth.
2. Call `GET /api/v1/me` and verify authenticated response.
3. Create business with `POST /api/v1/business`.
4. Try creating second business for same user and verify it is rejected.
5. In Supabase table editor, verify rows in `User`, `Session`, `Account`, `Business`.

## Backup / Restore Notes (for next phases)

- For production later, enable Supabase backups / PITR before cutover.
- Keep SQL schema changes tracked in repository and applied through Supabase SQL migrations.
