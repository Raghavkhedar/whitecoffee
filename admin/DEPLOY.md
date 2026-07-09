# WhiteCoffee Admin Portal — Setup & Deploy

## Step 1 — Get your Web App ID from Firebase Console

1. Go to https://console.firebase.google.com → select **white-coffee-92c27**
2. Click the gear icon → **Project Settings**
3. Scroll to **Your apps** → click **Add app** → choose **Web** (</>)
4. Name it "Admin Portal" → click **Register app**
5. Copy the `appId` value from the config snippet shown
6. Paste it in `.env.local`:

```
NEXT_PUBLIC_FIREBASE_APP_ID=1:905719927616:web:YOUR_APP_ID_HERE
```

All other values in `.env.local` are already filled in.

---

## Step 2 — Create your first admin user in Firestore

1. In Firebase Console → **Authentication** → create a user (email + password)
2. Copy the UID shown
3. In **Firestore** → `users/{UID}` → create document with:
   - `userId`: UID
   - `name`: Your Name
   - `email`: your-email@example.com
   - `role`: `admin`
   - `employeeId`: `ADMIN001`
   - `assignedSites`: (empty array)

---

## Step 3 — Install dependencies & run locally

```bash
cd whitecoffee-admin
npm install
npm run dev
```

Open http://localhost:3000 — log in with your admin credentials.

---

## Step 4 — Deploy to Firebase Hosting

### One-time setup (do this once):
```bash
npm install -g firebase-tools
firebase login
```

### Deploy:
```bash
npm run deploy
```

This runs `next build` (exports to `out/`) then `firebase deploy --only hosting`.

Your portal will be live at: **https://white-coffee-92c27.web.app**

---

## Firestore Indexes Required

Create these in Firebase Console → Firestore → Indexes → Composite:

| Collection group   | Fields                              |
|--------------------|-------------------------------------|
| `leave_requests`   | `status` ASC + `submittedAt` ASC    |
| `attendance`       | `date` ASC + `timestamp` ASC        |
| `material_requests`| `submittedAt` DESC                  |
| All other sub-cols | `submittedAt` DESC (if needed)      |

The app will show an error message with a direct link to create the index automatically when it's missing — just click that link.

---

## What the portal can do

| Page          | Features |
|---------------|----------|
| Dashboard     | Live stats: users, sites, pending leaves, today's check-ins |
| Users         | Add employees (auto creates Firebase Auth account), edit roles/sites, password reset |
| Sites         | Add/edit sites with GPS coordinates and geofence radius, assign employees |
| Leave Requests| View all leaves by status, approve or reject with comment |
| Attendance    | See all check-in/out events by date, grouped by employee, with map links |
| Submissions   | Browse all M&T requests, purchases, transfers, work progress entries |
