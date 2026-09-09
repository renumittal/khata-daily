# Khata Daily

A phone-first daily credit/debit tracker that stores entries locally and can sync each new entry to the supplied Google Sheet.

## Connect the Google Sheet

1. Open the supplied Google Sheet and choose **Extensions > Apps Script**.
2. Replace the editor contents with [`Code.gs`](Code.gs).
3. Click **Deploy > New deployment**.
4. Choose **Web app**, set **Execute as: Me**, and **Who has access: Anyone**.
5. Deploy, authorize access, and copy the web app URL ending in `/exec`.
6. Open the app, tap the gear button, paste the URL, and save the connection.

People live in the `People` tab, column A, starting at row 2 (`People` in cell A1). You can add names either by typing directly in the Sheet, or from the app itself: Settings tab → **Manage names** → type a name → **Add**. The app displays every active name with a Date, Purpose, and Amount, so multiple people can be saved together with one button. Saved entries go to the `Detail Transaction` tab.

Column B of the `People` tab marks a person's status: leave it blank for active, or set it to `inactive` to hide them from the app without deleting their name or their past entries. Toggling a name's "Active"/"Inactive" pill from Settings → Manage names does this for you automatically.

Note: `PEOPLE_SHEET_NAME` and `TRANSACTIONS_SHEET_NAME` at the top of `Code.gs` must match your Sheet's actual tab names exactly. If you rename either tab, update those two constants and redeploy.

If the app says `Check Apps Script access`, open **Deploy > Manage deployments**, edit the web app, create a **New version**, and set **Who has access** to **Anyone**. The deployed URL must open without asking you to sign in. Then refresh the app.

## Run the app

Serve this folder from any static web host or local server. A service worker and home-screen install require HTTPS (localhost is also allowed). Opening `index.html` directly works for recording locally, but Google Sheet sync requires a hosted URL.

The app keeps entries on the phone as a fallback. If the connection is missing or temporarily unavailable, the entry remains available locally and can be exported from Settings as JSON.
