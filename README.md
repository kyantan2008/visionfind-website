# VisionFind Sketch

## Project Overview

VisionFind Sketch is a school prototype for an AI-assisted investigation support tool.

Officers use an embedded Botpress assistant to collect witness-description information and generate an AI-assisted illustrative sketch. The sketch can be saved to history, and related CCTV sightings can be saved and displayed on a protected Leaflet case map.

This project is for demonstration and learning only. It does not identify real people, confirm identity, perform facial recognition, access real police systems, or prove where a person is located.

Use safe wording during presentation:

- AI-assisted sketch
- Illustrative visualisation
- Witness description
- Human review required
- Estimated CCTV trail
- Estimated search zone

Do not describe the output as a confirmed identity, exact route, face match, or verified suspect location.

## Roles

VisionFind Sketch uses two roles:

| Role | Access |
|---|---|
| Officer | Sketch Builder, History, Case Map |
| Supervisor | Supervisor Dashboard, History, Case Map |

Supervisors manage officer accounts. Supervisors do not use the Botpress sketch assistant.

## Main Features

- Premium black-and-gold VisionFind design
- Supabase Auth login
- Role-based page protection
- Officer-only Botpress Sketch Builder
- Supabase sketch history saving
- Supervisor officer management dashboard
- Protected Leaflet Case Sighting Map
- CCTV sightings saved through Express API routes
- Estimated CCTV trail between sightings
- Growing estimated search zone around the latest sighting
- Teammate mapping contribution preserved and extended

## Demo Login Accounts

Create these users in Supabase Auth, then add matching rows in `public.profiles`.

| Role | Email | Password |
|---|---|---|
| Officer | officer@visionfind.ai | officer123 |
| Supervisor | supervisor@visionfind.ai | supervisor123 |

## Folder Structure

- `public/index.html` — homepage
- `public/login.html` — Supabase login page
- `public/sketch-builder.html` — Officer Botpress sketch assistant page
- `public/history.html` — protected sketch history page
- `public/witness-tips.html` — protected witness-tip review page backed by the n8n TIPS branch
- `public/witness-tips.js` — safe witness-tip request and display logic
- `public/supervisor-dashboard.html` — Supervisor officer management page
- `public/case-map.html` — protected Leaflet official case-location map page
- `public/case-map.js` — teammate Leaflet map logic connected to the n8n CASES branch
- `public/script.js` — login, role protection, logout, history, supervisor dashboard, Botpress event saving
- `public/style.css` — black-and-gold theme and page styling
- `public/supabase-config.js` — Supabase URL and anon/publishable key
- `public/supabase-client.js` — browser Supabase client
- `public/assets/` — VisionFind logo assets
- `Mapping/` — original teammate mapping prototype files
- `server.js` — Express server, protected API routes, Supabase backend operations
- `README.md` — project documentation

## How to Run

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

If `npm start` is unavailable, run:

```bash
node server.js
```

3. Open:

```text
http://localhost:3000
```

If you recently changed `server.js`, restart the server so the latest API routes are active.

## Supabase Frontend Setup

Open:

```text
public/supabase-config.js
```

Set your Supabase anon or publishable key:

```js
const SUPABASE_URL = "https://bgohfiryjuqetmonqrsz.supabase.co";
const SUPABASE_ANON_KEY = "PASTE_YOUR_ANON_OR_PUBLISHABLE_KEY_HERE";
```

Do not place the Supabase service role key in frontend JavaScript.

## Backend Environment Setup

Create a `.env` file in the project root:

```text
SUPABASE_URL=https://bgohfiryjuqetmonqrsz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=replace-with-your-service-role-secret-key
PORT=3000
```

The service role key is required for secure backend operations such as officer management, sketch history saving, and protected case sighting API routes.

Never commit `.env` to GitHub.

## n8n Map and Telegram Connection

The browser never receives the private n8n webhook URL. Authenticated pages call the protected Express route `POST /api/visionfind`, and the server forwards only approved `witness` and `map` requests to n8n. The embedded sketch builder continues to save directly to Supabase History and does not depend on n8n.

Add these values to the private `.env` file:

```text
N8N_WEBHOOK_URL=https://n8ngc.codeblazar.org/webhook/visionfind-investigation
N8N_WEBHOOK_SECRET=
```

The expected n8n routing is:

- `witness` → read matching rows from the `TIPS` Google Sheet
- `map` → read all official matching rows from the `CASES` Google Sheet

Import `n8n/VisionFind_Map_and_Telegram.json` and follow `CONNECTION_SETUP.md`.

## Required Supabase Tables

### profiles

Stores user role information.

Recommended columns:

| Column | Type | Notes |
|---|---|---|
| id | uuid | Same value as `auth.users.id` |
| full_name | text | Display name |
| email | text | User email |
| role | text | `Officer` or `Supervisor` only |
| created_at | timestamptz | Optional timestamp |

### sketch_history

Stores saved sketch records.

Recommended columns:

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| user_id | uuid | Owner of the record |
| case_number | text | Case reference |
| witness_description | text | Description summary |
| summary | text | Short summary |
| image_path | text | Supabase storage path |
| mode | text | Source label |
| generation_id | text | Botpress/sketch generation reference |
| created_at | timestamptz | Record timestamp |

### app_settings

Optional table for app settings such as Botpress script URL.

| Column | Type | Notes |
|---|---|---|
| id | uuid | Primary key |
| setting_key | text | Example: `botpress_script_url` |
| setting_value | text | Botpress script URL |
| created_at | timestamptz | Optional timestamp |

### case_sightings

Stores CCTV sightings linked to a case and optional sketch reference.

Run this SQL in Supabase SQL Editor:

```sql
CREATE TABLE IF NOT EXISTS public.case_sightings (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  case_number text NOT NULL,
  sketch_id text,
  generated_image_url text,
  location_name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  seen_at timestamptz NOT NULL,
  movement_mode text DEFAULT 'unknown',
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS case_sightings_case_number_index
ON public.case_sightings (case_number);

CREATE INDEX IF NOT EXISTS case_sightings_seen_at_index
ON public.case_sightings (seen_at ASC);
```

If an older table used `sighted_at`, update it manually or recreate the table for the demo so the timestamp column is named `seen_at`.

## Sample CCTV Sighting Data

```sql
INSERT INTO public.case_sightings
(case_number, sketch_id, generated_image_url, location_name, latitude, longitude, seen_at, movement_mode, notes)
VALUES
('VF-2026-001', 'demo-generation-001', null, 'Orchard MRT Exit A', 1.3048, 103.8318, '2026-07-11T16:20:00+08:00', 'walking', 'Witness sighting'),
('VF-2026-001', 'demo-generation-001', null, 'Somerset MRT', 1.3006, 103.8389, '2026-07-11T16:45:00+08:00', 'public_transport', 'Second sighting');
```

## Botpress Setup

1. Go to Botpress.
2. Open Webchat > Deploy Settings.
3. Set Webchat mode to Embedded.
4. Set Container ID to:

```text
bp-embedded-webchat
```

The Botpress container is:

```html
<div id="bp-embedded-webchat"></div>
```

The embed script area is inside:

```text
public/sketch-builder.html
```

## Botpress Custom Events

The website already listens for Botpress `customEvent` messages.

### Save Sketch Event

Botpress can send:

```json
{
  "action": "saveSketch",
  "caseNumber": "VF-2026-001",
  "witnessDescription": "Witness description summary",
  "summary": "Generated sketch summary",
  "imageUrl": "https://example.com/sketch.png",
  "mode": "AI-generated",
  "generationId": "generation-id"
}
```

### Save CCTV Sighting Event

After asking whether the person was spotted on another CCTV camera, Botpress can send:

```json
{
  "action": "saveCaseSighting",
  "caseNumber": "VF-2026-001",
  "sketchId": "generation-id",
  "generatedImageUrl": "https://example.com/sketch.png",
  "locationName": "Shopping Centre Exit A",
  "latitude": 1.3521,
  "longitude": 103.8198,
  "seenAt": "2026-07-12T14:30:00+08:00",
  "movementMode": "walking",
  "notes": "Subject was moving towards the bus interchange.",
  "openMapAfterSave": true
}
```

Use the actual Botpress workflow variable names when building the bot flow.

## Case Sighting API

All case sighting API routes require a logged-in Officer or Supervisor Bearer token.

Retrieve sightings for one case:

```text
GET /api/case-sightings?caseNumber=VF-2026-001
```

Save a CCTV sighting:

```text
POST /api/case-sightings
```

Example request body:

```json
{
  "caseNumber": "VF-2026-001",
  "sketchId": "generation-id",
  "generatedImageUrl": "https://example.com/sketch.png",
  "locationName": "Shopping Centre Exit A",
  "latitude": 1.3521,
  "longitude": 103.8198,
  "seenAt": "2026-07-12T14:30:00+08:00",
  "movementMode": "walking",
  "notes": "Subject was moving towards the bus interchange."
}
```

Validation rules:

- `caseNumber` cannot be empty.
- `locationName` cannot be empty.
- Latitude must be between `-90` and `90`.
- Longitude must be between `-180` and `180`.
- `seenAt` must be a valid date/time.
- Future sighting times are rejected.
- Duplicate sighting submissions are rejected.

## Case Map Behaviour

Open:

```text
http://localhost:3000/case-map.html
```

Search for a case number such as:

```text
VF-2026-001
```

The map displays:

- Bright-red CCTV sighting markers
- Safe popups with case number, location, seen time, movement mode, notes, and optional sketch thumbnail
- Marker labels with Toggle Labels button
- Estimated CCTV trail when two or more valid sightings exist
- No trail line when only one sighting exists
- Estimated search zone around the latest sighting
- Search-zone metrics: elapsed time, radius, latest location, latest time, and movement mode

The trail and search zone are estimates only. They do not prove the person's route or current location.

## Teammate Mapping Contribution

The original map prototype in `Mapping/` was created by a project teammate. The integrated `public/case-map.js` keeps comments crediting that original Leaflet implementation and reuses the key ideas:

- OpenStreetMap tile layer
- Singapore map centre and bounds
- Marker display
- Label toggle
- Case search idea
- CSV parsing logic preserved as legacy documentation
- Route/trail display concept

## Troubleshooting

If the map does not show records:

- Restart the server after changing `server.js`.
- Check that `.env` contains `SUPABASE_SERVICE_ROLE_KEY`.
- Check Supabase has the `case_sightings` table.
- Check the browser Network tab for `/api/case-sightings?caseNumber=...`.
- Check the backend terminal for Supabase errors.
- Make sure you are logged in as Officer or Supervisor.

If Leaflet does not load:

- Check browser console for CDN errors.
- Confirm `case-map.html` loads Leaflet CSS and JS from `https://unpkg.com/leaflet@1.9.4/`.

If the API returns HTML instead of JSON:

- Restart the Express server.
- Confirm the latest `server.js` is running.
- Test an unknown route such as `/api/not-real`; it should return JSON.

## Safety Disclaimer

Generated images are illustrative sketches based on user-provided descriptions. They are not identity confirmations, facial recognition results, or verified evidence. Human review is required.

CCTV sightings, trails, and search zones are user-provided or estimated investigation aids. They do not confirm identity, contact, route taken, or current location.

## Future Improvements

- Connect Botpress variables fully to the `saveCaseSighting` event.
- Add a small Officer review form for manual CCTV sighting entry if needed.
- Add audit logs for saved sketch and sighting records.
- Add supervisor review for submitted CCTV sightings.
- Add better test data and a classroom demo script.
