# Vite Migration Notes

The project has been migrated from a static Babel/UMD prototype into a Vite React app.

## Current Structure

- `index.html` loads `/src/main.jsx`.
- `src/main.jsx` mounts React and imports `src/styles.css`.
- `src/app.jsx` exports the main `App` component.
- `src/data.js` exports structured seed data.
- `public/assets/` is served from `/assets/` by Vite.

## Run Locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`.

## Build

```bash
npm run build
npm run preview
```

## Next Migration Step

Replace the remaining local seed data with Supabase Auth, Postgres tables, RLS policies and private Storage. Public enquiries already have an Edge Function path with local fallback.
