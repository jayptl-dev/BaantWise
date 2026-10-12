# Backups

Supabase's free plan doesn't keep backups you can download. So Baantwise makes its own:
every night, a GitHub Action (`.github/workflows/backup.yml`) copies the whole database,
locks the copy with a passphrase, and keeps it for **30 days**.

**What's in a backup:** everything in the database: accounts (who signed in), profiles,
groups, members, expenses, payments, recurring rules, forwarded bills, settings, and the
migration history.

**What's not:** receipt photos (they live in Supabase Storage, not the database). The
expenses themselves are still in the backup, just without the picture.

## One-time setup (Jay)

1. **Get the connection string.** Supabase → your project → **Connect** (top of the page)
   → **Session pooler** → copy the string that starts with `postgresql://postgres.`.
   It has `[YOUR-PASSWORD]` in it: replace that with your database password.
   - Forgot the password? Supabase → **Project Settings → Database → Reset database password**.
     Resetting it is safe: the app and the Edge Functions don't use it.
2. **Pick a passphrase** for locking the backups: a long sentence only you know, for example
   four random words. **Save it in your password manager.** Without it, nobody (not even you)
   can open a backup.
3. **Add both as GitHub secrets.** GitHub → the BaantWise repo → **Settings → Secrets and
   variables → Actions → New repository secret**:
   - Name `SUPABASE_DB_URL`, value: the connection string from step 1
   - Name `BACKUP_PASSPHRASE`, value: the passphrase from step 2
4. **Run it once by hand.** GitHub → **Actions → Nightly backup → Run workflow**. After about
   2 minutes it should show a green tick, and the run page lists a file called
   `baantwise-backup-<date>`.

After that it runs by itself every night around 3 am Toronto time. If a run ever fails,
GitHub emails you.

## Restoring (only if something goes badly wrong)

Restoring overwrites data, so do it calmly, ideally with Claude's help. The safest way is
to restore into a **new** Supabase project first, check it, then switch the app over.

1. GitHub → **Actions → Nightly backup** → open the run from the day you want → download
   the `baantwise-backup-<date>` file and unzip it. You get `baantwise-<date>.tar.gz.gpg`.
2. Unlock and unpack it (it asks for the passphrase):
   ```sh
   gpg -d baantwise-<date>.tar.gz.gpg | tar -xzf -
   ```
   You now have `roles.sql`, `schema.sql`, `data.sql`, `history_schema.sql` and `history_data.sql`.
3. Create the new Supabase project (Canada Central), and turn on the same extensions
   (Database → Extensions: `pg_cron` and `pgcrypto`; the others are on by default).
4. Load it, using the new project's Session pooler connection string:
   ```sh
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file roles.sql --file schema.sql \
     --command 'SET session_replication_role = replica' \
     --file data.sql --dbname "<NEW_CONNECTION_STRING>"
   psql --single-transaction --variable ON_ERROR_STOP=1 \
     --file history_schema.sql --file history_data.sql --dbname "<NEW_CONNECTION_STRING>"
   ```
5. Then set up the rest again in the new project: Google sign-in, the Edge Functions and
   their secrets, the Realtime tables (`groups`, `group_members`, `expenses`, `settlements`),
   the `receipts` Storage bucket and the `baantwise-recurring` cron job. Finally point the
   app (`src/config.ts`) at the new project.

Supabase's own guide, with fixes for common restore errors:
https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
