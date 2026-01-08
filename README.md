<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1N_cUOsvs1kMITtRBm36EByT9In92yPmo

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm ci`
2. Start Firebase Functions (emulator recommended for local dev):
   - In one terminal:
     `cd firebase/functions && npm ci && npm run build && firebase emulators:start --only functions`
3. Point the web app at your Functions origin and run Vite:
   - In another terminal (project root):
     `export VITE_FUNCTIONS_ORIGIN=http://127.0.0.1:5001/YOUR_PROJECT_ID/us-central1 && npm run dev`
Production note: set the Gemini key via Firebase Functions config as described in `docs/DeploymentGuide.md` (do not ship it in the frontend).

## Deploy to GitHub Pages (production with real functions)

This repo contains a GitHub Actions workflow that builds the app and publishes the `dist` folder to GitHub Pages. The deployed site will call your real Functions endpoints — no mock data — so you must provide the Functions origin as a repository secret.

1. Build & deploy (automated): push to `main`. The workflow reads the repo secret `FUNCTIONS_BASE_URL`.

2. Repository secret required:
   - `FUNCTIONS_BASE_URL`: The base URL where your hosted Functions are reachable. Example for Firebase Functions: `https://us-central1-<PROJECT_ID>.cloudfunctions.net`

3. Where to get the `FUNCTIONS_BASE_URL`:
   - If you deploy to Firebase Functions, the origin is typically `https://us-central1-<PROJECT_ID>.cloudfunctions.net` (replace `<PROJECT_ID>` with your Firebase project id).
   - If you deploy to another host, use that functions base URL.

4. Setting the Gemini API key (server-side):
   - Obtain a Google GenAI / Gemini API key or service account credential from the Google Cloud Console. Typically:
     - Go to the Google Cloud Console -> APIs & Services -> Credentials
     - Create an API key or a service account key and enable the Generative AI / Vertex AI APIs as required.
   - For Firebase Functions, set the key in the functions config (keeps it out of the frontend):
```bash
cd firebase/functions
firebase functions:config:set gemini.key="YOUR_GEMINI_API_KEY"
firebase deploy --only functions
```

5. Add the repository secret in GitHub:
   - Settings -> Secrets and variables -> Actions -> New repository secret
   - Name: `FUNCTIONS_BASE_URL`
   - Value: your functions origin (see step 3)

6. The Actions workflow will set `VITE_USE_MOCK_FUNCTIONS=false` during build so the frontend calls your real functions.

If you want me to run the initial build-and-deploy from this environment, I can (requires repo write permissions and auth). Otherwise, set the secret and push to `main` to trigger the workflow.
