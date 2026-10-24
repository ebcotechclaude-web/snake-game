# Deploying Snake Game to Render (free)

1. Create a free GitHub account (github.com) and a new **public or private** repository named `snake-game`.
2. In the repo, choose **Add file -> Upload files** and drag in everything in this folder EXCEPT `node_modules` and `tools`
   (keep the `public` folder structure). Commit.
3. Create a free Render account (render.com) using "Sign in with GitHub".
4. In Render: **New -> Blueprint**, pick the `snake-game` repo, and apply. `render.yaml` sets everything up
   (free plan, `npm install`, `npm start`, health check, `TRUST_PROXY=1`).
5. When the deploy finishes, the link looks like `https://snakegame.onrender.com` (Render adds a random suffix if the name is taken).

Notes
- The free plan sleeps after 15 minutes without traffic; the first visit after that takes about a minute to wake.
- Free instances have 512 MB RAM and a small CPU, so keep the player count modest.
