# AMA ID Cards: setup guide

What's in this folder:

| Folder | What it is |
|---|---|
| `web` | The website you open on your phone and laptop |
| `supabase` | `setup.sql`, which creates the database |
| `print-station` | The helper that runs on the laptop and prints approved cards |
| `card-artwork` | The signature and front image, to upload once in Card settings |

Everything here is free. It takes about 20 minutes the first time.

---

## 1. Create the database (Supabase, about 10 minutes)

1. Go to **supabase.com**, sign up, and click **New project**.
   - Name: `AMA ID Cards`
   - Region: **Sydney**
   - Database password: make a strong one and save it somewhere safe (you will rarely need it).
2. When the project is ready, open **SQL Editor**, click **New query**, paste the whole of `supabase/setup.sql`, and click **Run**. It should say "Success".
3. Turn off public sign-ups so only people you add can get in:
   **Authentication > Sign In / Providers**, then switch off **Allow new users to sign up** and save.
4. Add your login:
   **Authentication > Users > Add user > Create new user**. Enter your email and a password, tick **Auto Confirm User**, and create.
5. Add a second login for the print station, the same way. Any email works, for example `yourname+printer@gmail.com`. Give it its own password.
6. Copy two values for later from **Project Settings > API Keys** (or the **Connect** button at the top):
   - **Project URL**, like `https://abcdefgh.supabase.co`
   - **anon public key** (on newer projects this is the **Publishable key**)

## 2. Put the website online (Netlify, about 5 minutes)

1. Open `web/config.js` in Notepad and paste in the Project URL and anon key. Save.
2. Go to **app.netlify.com/drop**, sign up free, and drag the whole `web` folder onto the page.
3. In Netlify, go to **Site configuration > Change site name** and pick something like `ama-id-cards`. Your address becomes `https://ama-id-cards.netlify.app`.
4. Open that address on your phone and sign in. In Safari or Chrome, use **Add to Home Screen** so it opens like an app.

To update the website later, open the site in Netlify, go to **Deploys**, and drag the `web` folder in again.

## 3. First sign-in

1. **Card settings > Upload signature**: choose `card-artwork/signature.png`.
2. To bring over your existing people: open the old version, click **Backup**, then in the new site click **Restore** and choose that file. Photos come across too.

## 4. Set up the print station on the laptop (about 5 minutes)

The laptop must be Windows and connected to the PPC ID 4000.

1. Install **Node.js LTS** from **nodejs.org** (click through the installer with the default options).
2. Copy the `print-station` folder somewhere permanent, for example `Documents\AMA Print Station`.
3. In that folder, copy `config.example.json` and rename the copy to `config.json`. Open it in Notepad and fill in:
   - `supabaseUrl` and `supabaseAnonKey`: the same two values as the website
   - `email` and `password`: the **print station** login from step 1.5
   - `printer`: the printer's exact name as shown in **Windows Settings > Bluetooth & devices > Printers & scanners**. Usually `PPC ID 4000`.
4. Double-click **install.bat**. It installs, checks the sign-in and the printer, then starts the print station.
   It also starts by itself every time you log in to Windows. There is no window; it runs in the background.

On the website, the badge at the top should now say **Print station online**.

## 5. Test it

1. Select one person and click **Send selected to printer**.
2. On your phone, under **Printing**, tap **Approve**.
3. The card prints and the job changes to **Printed**.

If the back of the card prints upside down, open `config.json`, change `"duplexSide": "duplexlong"` to `"duplexshort"`, save, then double-click **stop.bat** and then **start-hidden.vbs**.

Turn off **Jobs need approval before they print** if you want cards to print as soon as they are sent.

## 6. Phone notifications (optional, about 5 minutes)

Get a notification when cards need approval or a print fails.

1. In Supabase, open **SQL Editor > New query**, paste the whole of `supabase/notifications.sql`, and click **Run**.
2. Open **Edge Functions > Deploy a new function > Via Editor**. Name it `notify`, replace the example code with the whole of `supabase/functions/notify/index.ts`, and click **Deploy**.
3. Open the new `notify` function's **Details** (or settings) and turn **off** "Enforce JWT verification" (also called "Verify JWT"). Save.
4. On your phone:
   - **iPhone:** open the site in Safari, tap **Share > Add to Home Screen**, then open AMA Cards from the Home Screen. (Apple only allows notifications for apps on the Home Screen.)
   - **Android:** open the site in Chrome.
5. In the app, go to **More > Notifications > Turn on notifications** and tap **Allow**. Then tap **Send a test**.

Each person turns notifications on for their own phone. You're never notified about cards you sent yourself.

## 7. User roles

| Role | Can do |
|---|---|
| Admin | Everything, including card design, backups and managing users |
| Approver | Add, edit and delete people, take photos, send and approve prints |
| Photos | Add people, edit their details and take photos |
| Viewer | Look only |
| Print station | Only for the laptop's print station login |

1. In Supabase, open **SQL Editor > New query**, paste the whole of `supabase/roles.sql`, and click **Run**. Everyone who can already sign in becomes an Admin.
2. Update the `notify` Edge Function with the latest `supabase/functions/notify/index.ts` (it adds and removes logins for you).
3. In the app, go to **More > Users** and set the print station's login to **Print station**.
4. Add new people from **More > Users > Add a user** with their email, role and a starting password. You no longer need to create logins in Supabase.

There is always at least one Admin; the app won't let the last one be removed or downgraded.

---

## Good to know

- **The printer must be on with blank cards loaded, and the laptop awake.** Set the laptop to never sleep while plugged in (Windows Settings > System > Power). Jobs sent while the laptop is off wait and print once it is back on.
- **Approving and printing:** anyone with a login can send and approve jobs. Only add logins for people you trust with members' details.
- **Privacy:** the database is locked so only signed-in users can see anything. Anyone who finds the website address sees only the sign-in screen.
- **Free plan limits:** 500 MB of data and 1 GB of files, enough for thousands of members. Supabase pauses free projects after a week with no activity. The print station keeps it active while the laptop is on. If it ever pauses, open supabase.com and click **Restore project**; nothing is lost.
- **Problems printing:** open `agent.log` in the `print-station` folder. It records every job and any error. A failed job shows the reason on the website with a **Try again** button.
- **To remove the print station:** double-click **uninstall.bat**.
