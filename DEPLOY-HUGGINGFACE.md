# Deploying for free on Hugging Face Spaces + Neon

Both services are free and need no card:
- **Hugging Face Spaces** runs the app container: frontend, API, background worker and a
  private Redis.
- **Neon** hosts the PostgreSQL database, so accounts and projects are kept permanently.

The site address looks like `https://<your-hf-username>-ai-software-engineer.hf.space`.

**Know before you start**
- Free Spaces go to sleep after about two days without visitors. The next visit wakes the Space
  in about a minute.
- The Space's disk is wiped whenever it restarts. Accounts, projects and repository records
  stay in Neon, but **uploaded code must be ingested again** after a restart. Open the repository
  and click **Upload and ingest** (or **Ingest from GitHub**) again.

Files: [deploy/huggingface/Dockerfile](deploy/huggingface/Dockerfile),
[deploy/huggingface/README.md](deploy/huggingface/README.md) and
[deploy/huggingface/start.sh](deploy/huggingface/start.sh).

## 1. Create the database on Neon (about 5 minutes)

1. Sign up at https://neon.tech (GitHub, Google or email).
2. Create a project: name `ai-software-engineer`, Postgres 16 or newer, region
   **AWS US East (N. Virginia)**, close to Hugging Face's servers.
3. On the project dashboard, click **Connect**.
4. **Turn off "Connection pooling"**. The app needs a direct connection.
5. Copy the connection string. It looks like
   `postgresql://neondb_owner:...@ep-....us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.
   Use it exactly as shown; the app adapts the `sslmode` and `channel_binding` options itself.
   Keep it private: it contains the database password.

## 2. Create a secret key (1 minute)

The app signs logins with a secret key. In Windows PowerShell, run:

```powershell
$b = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
```

Copy the output. It is your `SECRET_KEY`.

## 3. Create the Space (about 5 minutes)

1. Sign up at https://huggingface.co (email; no card).
2. Open https://huggingface.co/new-space and fill in:
   - **Space name**: `ai-software-engineer`;
   - **SDK**: **Docker**, template **Blank**;
   - **Hardware**: **CPU basic (free)**;
   - **Visibility**: Public or Private (both work).
3. Click **Create Space**.
4. Open the **Files** tab and replace the two files:
   - Click `README.md`, then **Edit**. Replace everything with the contents of
     [deploy/huggingface/README.md](https://github.com/shreyasvishwa1/ai-software-engineer-codebase/blob/main/deploy/huggingface/README.md),
     then **Commit changes**.
   - Click **+ Add file → Create a new file**. Name it `Dockerfile` and paste the contents of
     [deploy/huggingface/Dockerfile](https://github.com/shreyasvishwa1/ai-software-engineer-codebase/blob/main/deploy/huggingface/Dockerfile),
     then **Commit new file**.

## 4. Add the settings (about 3 minutes)

In the Space, open **Settings → Variables and secrets** and add:

| Type | Name | Value |
| --- | --- | --- |
| Secret | `DATABASE_URL` | The Neon connection string from step 1 |
| Secret | `SECRET_KEY` | The key from step 2 |
| Variable | `APP_BASE_URL` | `https://<your-hf-username>-ai-software-engineer.hf.space` |

Optional extras, all as **secrets**:
- **Free AI explanations**: `GEMINI_API_KEY`, from https://aistudio.google.com/apikey. On the
  free tier, Google may use the explained files to improve its products.
- **Password reset emails**: `SMTP_HOST` = `smtp.gmail.com`, `SMTP_USERNAME` and `SMTP_FROM` =
  your Gmail address, `SMTP_PASSWORD` = a Google app password.

Hugging Face restarts the Space after each change.

## 5. Open the site

The Space builds for about 10 minutes the first time; the **Logs** tab shows progress. When the
status turns **Running**, open `https://<your-hf-username>-ai-software-engineer.hf.space`
directly (it is faster than the framed page on huggingface.co). Register and sign in.

## Updating after new commits

The Space pulls the code from GitHub when it builds. After new commits reach GitHub, open the
Space's **Settings** and click **Factory rebuild**.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Logs say "Set the DATABASE_URL and SECRET_KEY secrets" | Add both secrets (step 4) |
| Logs show a database connection error | Check that `DATABASE_URL` is the **direct** (non-pooled) Neon string, pasted in full |
| A repository shows files but they cannot be opened | The Space restarted and cleared its disk; ingest the repository again |
| The page takes about a minute to load | The Space was asleep; it wakes on the first visit |
