# Deploying for free on Render + Neon

Both services are free and need no card:
- **Render** runs one web service built from [deploy/render/Dockerfile](deploy/render/Dockerfile).
  It holds the frontend, API, background worker and a private Redis.
- **Neon** hosts the PostgreSQL database, so accounts and projects are kept permanently.

[render.yaml](render.yaml) is a Render Blueprint: Render reads it and fills in the service
settings, including a generated `SECRET_KEY`.

**Know before you start (free plan limits)**
- The service **sleeps after 15 minutes** without visitors. The next visit wakes it, which takes
  about **1.5–2 minutes** on the free CPU, and Render shows a loading page meanwhile.
- The disk is wiped whenever the service sleeps, restarts or redeploys. **Nothing has to be
  uploaded again**: accounts, projects, repositories and the files themselves are kept in Neon,
  and a repository's files are restored automatically (each checked against its SHA-256) the
  first time they are needed after a wake-up. Stored files count toward Neon's free 0.5 GB.
  Repositories imported before this was added need one last import; their page says so.
- Render blocks SMTP email on the free plan. Password reset emails work through **Brevo**
  instead (free, sent over HTTPS); see "Password reset emails" below.
- One service running all month fits in the free 750 instance hours.

## 1. Create the database on Neon (about 5 minutes)

1. Sign up at https://neon.tech and create a project (for example `codebase-analysis`) in
   **AWS US East 2 (Ohio)**, the same area as the Render service.
2. Click **Connect**, **turn off "Connection pooling"**, and copy the connection string. It
   looks like
   `postgresql://neondb_owner:...@ep-....us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.
   Use it exactly as shown; the app adapts the `sslmode` and `channel_binding` options itself.
   Keep it private: it contains the database password.

## 2. Create the service on Render (about 10 minutes, plus the first build)

1. Sign up at https://render.com with **GitHub**, and allow Render to access the
   `codebase-analysis` repository.
2. In the dashboard, click **New → Blueprint** and pick the repository. Render reads
   `render.yaml` and shows one web service, `codebase-analysis`, on the **Free** plan.
3. Fill in the values Render asks for:
   - `DATABASE_URL`: the Neon connection string.
   - `APP_BASE_URL`: `https://codebase-analysis.onrender.com`. Change it later if you add
     your own domain (step 3), or if Render gives the service a different address.
   - `GEMINI_API_KEY`: optional; leave it empty, or paste a free key from
     https://aistudio.google.com/apikey to enable AI explanations.
4. Click **Apply** (or **Deploy Blueprint**). The first build takes 5–10 minutes. When the
   service shows **Live**, open its `onrender.com` address, register and sign in.

Every push to `main` on GitHub redeploys the service automatically.

## 3. Optional: use your own domain (about 5 minutes)

For example, to serve the app at `code.nammaicons.com` without touching the main site:

1. In Render, open the service, then **Settings → Custom Domains → Add Custom Domain**, and
   enter `code.nammaicons.com`. Render shows the target to point it at (the service's
   `onrender.com` address).
2. In Hostinger, open **Domains → nammaicons.com → DNS / Nameservers**, and add a record:
   - **Type**: `CNAME`;
   - **Name**: `code`;
   - **Target**: the `onrender.com` address from Render;
   - **TTL**: leave the default.
3. Back in Render, click **Verify**. Render issues the HTTPS certificate automatically, which
   can take a few minutes after DNS updates.
4. In **Environment**, change `APP_BASE_URL` to `https://code.nammaicons.com` and save.

## Password reset emails (Brevo, free)

1. Sign up at https://www.brevo.com (free plan, about 300 emails a day).
2. In Brevo, open **Senders, Domains & Dedicated IPs → Senders → Add a sender**, enter the
   address emails should come from (for example a Gmail address made for this app), and confirm
   the code Brevo sends to it.
3. Open **SMTP & API → API keys → Generate a new API key** and copy it.
4. In Render, open the service's **Environment** and add `BREVO_API_KEY` (the key) and
   `EMAIL_FROM` (the verified sender address), then save. Make sure `APP_BASE_URL` is the
   site's real address, because reset links point there.

## Classroom or event mode

Sign-ups (5 per hour) and login attempts (10 per minute) are limited **per network address**.
A whole class on one Wi-Fi shares a single address, so raise the limits before the session:

1. In Render, open the service's **Environment**.
2. Set `REGISTER_IP_LIMIT` to `200` and `LOGIN_IP_LIMIT` to `300`, then save (the service
   redeploys).
3. Set them back to `5` and `10` afterwards.

## Before a demo or class

1. Open the site about **5 minutes early**, so it is awake.
2. Sign in and open your repository; its files come back on their own after the wake-up. No
   archive at hand? **Import the sample** on the Upload page.
3. Keep the tab open; the service stays awake while people use it.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Logs say "Set DATABASE_URL and SECRET_KEY" | Add `DATABASE_URL` in **Environment**; `SECRET_KEY` is generated by the Blueprint |
| Logs show a database connection error | Use the **direct** (non-pooled) Neon string, pasted in full |
| A loading page for 1–2 minutes | The service was asleep; it is starting |
| "This repository's files are no longer on the server" | It was imported before files were kept in the database; import it once more and it is kept from then on |
| "Too many requests" during a class | Raise `REGISTER_IP_LIMIT` and `LOGIN_IP_LIMIT` (classroom mode) |
