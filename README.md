# White Coffee — Field Operations Management App

An Android app built for **Senken Engineering** to manage field operations, attendance, material requests, and team coordination.

---

## Features

### Attendance
- **Operations team** — GPS-based event tracking (Home → Site → Market → Home)
- **Office/Sales team** — Multi-cycle check-in/out with free-text location name

### Material & Tool Management
- M&T Requests — request materials/tools with line items and photos
- M&T Purchases — log purchases with per-item pricing and grand total
- Material Transfers — record handover between locations with photos
- Tool Transfers — record tool handovers between teams

### Work Progress
- Daily work reports with hours, description, site details, and photo attachments

### Leave Management
- Apply for leave (Sick, Casual, Annual, Unpaid)
- View personal leave history
- Admin approval/rejection with comments

### Notifications
- In-app notification center with unread badge
- Push notifications via FCM

### Admin
- User management (create/edit operations, office, admin accounts)
- Site management
- Leave approvals

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Kotlin |
| UI | XML Views (MVVM + ViewBinding) |
| Architecture | MVVM + Repository + Hilt |
| Backend | Firebase Auth + Firestore + Storage |
| Async | Coroutines + StateFlow |
| DI | Hilt 2.52 |
| Build | AGP 8.7.3 / Gradle 8.9 / KSP 2.0.21 |

---

## Architecture

```
UI (Fragments)
    ↓
ViewModels  ← StateFlow<UiState<T>>
    ↓
Repositories  ← only layer touching Firebase
    ↓
Firebase (Auth / Firestore / Storage)
```

- One Firestore document per attendance event (GPS always captured)
- All user data in sub-collections: `/users/{uid}/{collection}/{docId}`
- Optimistic UI updates after check-in — no re-fetch needed
- Role-based access: `operations` / `office` / `admin`

---

## Admin Web Portal

A companion Next.js admin dashboard is available separately for:
- Viewing all submissions (M&T requests, purchases, transfers, work progress)
- Leave approvals
- Attendance monitoring
- Sending push notifications to teams
- Auto-exported Google Sheets (daily via Cloud Functions)

---

## Role Access

| Feature | Operations | Office | Admin |
|---|---|---|---|
| GPS Attendance | Yes | — | — |
| Office Attendance | — | Yes | Yes |
| M&T Request | Yes | — | — |
| M&T Buy | Yes | Yes | Yes |
| Transfers | Yes | Yes | Yes |
| Work Progress | Yes | — | — |
| Leave | Yes | Yes | Yes |
| Leave Approvals | — | — | Yes |
| User/Site Management | — | — | Yes |

---

## Project Structure

```
com.raghav.whitecoffee
├── core/          UiState, BaseFragment
├── data/          Models, Repositories, SessionManager, LocationProvider
├── di/            Hilt modules (Firebase, Location)
├── service/       FcmService
└── ui/            Login, Home, Attendance, Requests, Notifications, Admin
```

---

## Setup

1. Clone the repo and open in Android Studio
2. Add your `google-services.json` from Firebase Console to `app/`
3. Enable Firebase Auth (Email/Password), Firestore, Storage, and Cloud Messaging
4. Build and run on a device or emulator (API 26+)

> Firestore security rules are in `firestore.rules` at the project root — deploy via Firebase Console.
