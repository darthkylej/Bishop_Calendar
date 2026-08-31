# Bishop Interview Calendar

A small scheduling app built in the same style as Stroll to the Stable: Cloudflare Worker backend + static vanilla frontend + Neon Postgres.

## What it does

- Week-at-a-glance scheduling board
- Preferred availability and "available if needed" time ranges
- Recurring weekly availability
- One-date additions and blocked-time exceptions
- Fast appointment scheduling and editing
- Database-enforced protection against overlapping scheduled appointments
- Bishop, scheduler, and viewer roles
- Bishop-only user management
- Signed, stateless, secure session cookies
- No framework and no file storage service required

## Setup

### 1. Neon
Create a Neon database and run `schema.sql` once.

### 2. Cloudflare secrets

```bash
wrangler secret put DATABASE_URL
wrangler secret put SESSION_SECRET
wrangler secret put BOOTSTRAP_SECRET
```

Use the pooled Neon connection string for `DATABASE_URL`. `SESSION_SECRET` should be a long random value. `BOOTSTRAP_SECRET` is only used to create the first bishop account.

### 3. Install and deploy

```bash
npm install
npm run deploy
```

For local development:

```bash
npm run dev
```

### 4. Create the first bishop account
After deploying, visit `/setup.html`. Enter your name, email, desired password, and the same `BOOTSTRAP_SECRET` you put into Wrangler. The endpoint permanently refuses to create another bootstrap account once the users table contains a user.

Then sign in at `/login.html`.

## Roles

- **bishop** — manage availability, users, and all appointments; may deliberately schedule outside normal availability
- **scheduler** — create and edit appointments inside defined availability
- **viewer** — read-only schedule access

## Availability model

Recurring availability is stored by weekday. A date exception can either add a special available range or block part of a recurring range.

The calendar shows preferred and secondary availability differently. Unavailable time is visually plain. The visible time range automatically narrows around actual availability and appointments so the secretary is not forced to scroll through an entire 24-hour day.

## Appointment conflicts

`schema.sql` creates a PostgreSQL exclusion constraint on scheduled appointment time ranges. This prevents overlapping appointments even if two schedulers try to save conflicting appointments at nearly the same instant.

## Current defaults

- Time zone: America/Chicago
- Grid interval: 15 minutes
- Default appointment duration: 20 minutes

These are stored in the `settings` table.
