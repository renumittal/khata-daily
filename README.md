# Khata Daily

A phone-first daily credit/debit tracker that stores entries locally and can sync each new entry to the supplied Google Sheet.

## Connect the Google Sheet

1. Open the supplied Google Sheet and choose **Extensions > Apps Script**.
2. Replace the editor contents with [`Code.gs`](Code.gs).
3. Click **Deploy > New deployment**.
4. Choose **Web app**, set **Execute as: Me**, and **Who has access: Anyone**.
5. Deploy, authorize access, and copy the web app URL ending in `/exec`.
6. Open the app, tap the gear button, paste the URL, and save the connection.

Put the people names in column A of `Sheet1`, starting at row 2, with `People` in cell A1. The app displays every name with an amount box beside it, so multiple people can be saved together with one button. The script reads names from `Sheet1` and automatically creates a separate `Transactions` tab for saved entries. Each entry also supports an optional household category such as groceries, rent, or utilities.

If the app says `Check Apps Script access`, open **Deploy > Manage deployments**, edit the web app, create a **New version**, and set **Who has access** to **Anyone**. The deployed URL must open without asking you to sign in. Then refresh the app.

## Run the app

Serve this folder from any static web host or local server. A service worker and home-screen install require HTTPS (localhost is also allowed). Opening `index.html` directly works for recording locally, but Google Sheet sync requires a hosted URL.

The app keeps entries on the phone as a fallback. If the connection is missing or temporarily unavailable, the entry remains available locally and can be exported from Settings as JSON.
