# VektraLock — Phase 1 & 2 (local app + Postgres, pre-AWS)

Auth + file upload/download/search/share API, using local disk storage for
files for now. Phase 3 will swap local disk for S3 without changing any
route behavior.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start Postgres locally with Docker:
   ```
   docker compose up -d
   ```

3. Copy the env file and adjust if needed:
   ```
   cp .env.example .env
   ```

4. Run the Prisma migration to create the database tables:
   ```
   npx prisma migrate dev --name init
   ```

5. Start the server:
   ```
   npm run dev
   ```

Server runs at `http://localhost:3000`. Health check: `GET /health`.

## API reference (test with Postman / Thunder Client / curl)

### Auth
- `POST /api/auth/signup` — body: `{ "email": "...", "password": "..." }`
  (first signup ever becomes ADMIN, everyone after is USER)
- `POST /api/auth/login` — body: `{ "email": "...", "password": "..." }`
  → returns `{ token, user }`. Use the token as `Authorization: Bearer <token>`
  on every request below.

### Files
- `POST /api/files/upload` — multipart/form-data, field `file` (any type),
  optional field `category`
- `GET /api/files` — list your own files. Optional query: `?search=name&category=xyz`
- `GET /api/files/:id/download` — download a file you own (or any file, if admin)
- `POST /api/files/:id/share` — generates a 1-hour temporary public link
- `GET /api/files/shared/:token` — download via the temporary link, no auth needed
- `GET /api/files/admin/all` — admin-only: list every user's files

## What's next (Phase 3+)

- Swap local disk storage in `src/routes/files.js` for AWS S3 (upload,
  download via pre-signed URL, share link via `getSignedUrl`).
- Move this Postgres instance to AWS RDS.
- Deploy to EC2 with an IAM role attached (no hardcoded AWS keys).
- Nginx reverse proxy + HTTPS.
- GitHub Actions CI/CD.
