# Put Flow 1 online (one link for the team)

After this, the page and the backend live at one web address. Anyone with the
link can open it, and everyone's progress saves to the same Supabase database.

## Before you start
- Use a **new free Supabase project** for this (not the team's GEO one). It
  keeps Flow 1 data separate. The tables are named `flow1_...` so they will not
  clash, but a separate project is the safest.
- Put this folder in a **GitHub repo** (a new private one is fine).

## Step 1: Get the Supabase database link
1. Supabase > your project > **Project Settings > Database**.
2. Under **Connection string**, pick **Session pooler** and copy the URI.
3. Replace `[YOUR-PASSWORD]` in it with your database password.
   Keep this link private. It is a password.

## Step 2: Deploy on Render
1. Go to render.com, sign in with GitHub.
2. **New > Web Service**, pick your repo.
3. If the repo is the whole Geo project, set **Root Directory** to `geo-flow1-backend`.
4. Fill in:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Instance type: Free
5. Under **Environment**, add `DATABASE_URL` = the link from Step 1.
6. Click **Create Web Service**. After a few minutes you get a link like
   `https://something.onrender.com`. Open it. That is Flow 1.

The database tables are created automatically the first time it starts.

## Good to know
- **No login.** Anyone who has the link can open it and see saved setups,
  including transcripts. Only share it with people who should see them.
- The free Render plan goes to sleep when nobody uses it. The first open after
  a quiet spell can take about a minute.
- Each browser keeps its own "current setup". A teammate opening the link
  starts their own setup. Sharing one setup between people is a next step.
- To check it is alive: open `your-link/api/health`.
