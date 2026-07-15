# VisionFind Map + Telegram Connection

This package keeps the embedded sketch builder independent. Only these two website features use n8n:

- **Witness Tips** reads Telegram reports from the `TIPS` Google Sheet.
- **Case Map** reads official locations from the `Cases` Google Sheet.

## 1. Import the n8n workflow

Import `n8n/VisionFind_Map_and_Telegram.json` into n8n.

Open both Google Sheets nodes and select your existing Google Sheets credential:

- `Get Witness Tips` → sheet `TIPS`
- `Get Official Case Locations` → sheet `Cases`

Confirm the document is `VisionFind_Case_Database`, then save and activate the workflow.

The production webhook must be exactly:

`https://n8ngc.codeblazar.org/webhook/visionfind-investigation`

There must not be a space before `visionfind-investigation`.

## 2. Create the website `.env`

Copy `.env.example` and rename the copy to `.env`. Fill in the two Supabase values. Keep the n8n URL as provided.

Do not put the Supabase service-role key in any file inside `public/`, and do not send it to teammates through chat.

## 3. Install and run

In this project folder, run:

```powershell
npm install
npm start
```

Open `http://localhost:3000` and log in as an Officer or Supervisor.

## 4. Test Telegram witness tips

1. Submit a complete tip through Telegram with a Case ID such as `VF001`.
2. Confirm the row is appended to the `TIPS` sheet.
3. Open `http://localhost:3000/witness-tips.html`.
4. Search the same Case ID.
5. The page should show every matching tip.

## 5. Test the map

1. Confirm the `Cases` sheet has all official rows for a Case ID.
2. Open `http://localhost:3000/case-map.html`.
3. Search the Case ID.
4. The page should show every valid coordinate, ordered using the date and time values.

The map uses only official `Cases` records. Telegram tips remain unverified and do not become official map locations.

## Troubleshooting

- **404 webhook not registered:** activate the workflow and use the production URL above.
- **Validation error:** the request must contain `feature` and `case_id`; `user_id` is not required.
- **Map does nothing:** confirm the n8n map rule is `map` without a leading space.
- **No results hangs:** both Google Sheets nodes have `Always Output Data` enabled.
- **Login error:** verify the Supabase URL, service-role key, user account and profile role.
