# Hazeltun Proxy — Vercel deployment

This project keeps the existing Hazeltun interface and adds Vercel serverless API routes for the proxy backend.

## Deploy
1. Upload/replace the files in your existing GitHub repository with the contents of this folder. Keep the `api/`, `lib/`, `public/`, `index.html`, `package.json`, and `vercel.json` paths exactly as shown.
2. In Vercel, open your project → Settings → Environment Variables.
3. Add `HAZELTUN_CODE` with the four-digit code you want to use. If omitted, the existing default `4578` is used.
4. Add `HAZELTUN_SESSION_SECRET` with a long random secret (at least 32 random characters). Do not share it or put it in GitHub.
5. Apply the variables to Production (and Preview if needed), then redeploy.

The old `server.mjs` remains for local use. Vercel uses the `api/` functions and `vercel.json` rewrites.

## Important limitations
This is a lightweight page proxy, not a full browser. Some sites will fail because they rely on complex JavaScript, WebSockets, cross-origin APIs, sign-in flows, or anti-bot protections. Do not use it to enter passwords or sensitive information. Only proxy sites you are allowed to access.
