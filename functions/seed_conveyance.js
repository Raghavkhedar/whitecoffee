/**
 * One-time seed script — adds test attendance data for conveyance testing.
 * Run from functions/ directory:  node seed_conveyance.js
 * Delete this file after testing.
 */

const admin = require("firebase-admin");
const serviceAccount = require("C:/Users/ragha/AppData/Local/Temp/wckey.json");

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db    = admin.firestore();
const auth  = admin.auth();

// ── Test scenario: 2 employees, today's date ─────────────────────────────────
// Route: Noida (Home) → DLF Gurugram (Site) → Faridabad (Site) → Noida (Home)
// Expected road distances (Google Maps approx):
//   Noida → Gurugram:   ~46 km
//   Gurugram → Faridabad: ~32 km
//   Faridabad → Noida:  ~28 km   Total: ~106 km  @ ₹2.5 = ₹265

const TODAY = "2026-06-09";

const GPS = {
  home:        { lat: 28.6257, lon: 77.3760 },  // Noida Sector 62
  site_gurgaon:{ lat: 28.4943, lon: 77.0886 },  // DLF Cyber Hub, Gurugram
  site_faridabad: { lat: 28.4089, lon: 77.3178 }, // Faridabad
};

// IST timestamps for today
function ist(hh, mm) {
  // IST = UTC+5:30 → subtract 5h30m to get UTC
  const d = new Date(`2026-06-09T${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}:00+05:30`);
  return admin.firestore.Timestamp.fromDate(d);
}

const EMPLOYEES = [
  { email: "test@whitecoffee.com",      name: "Test User",   employeeId: "EMP001" },
  { email: "operations@senken.com",     name: "Operations",  employeeId: "EMP002" },
];

async function seed() {
  for (const emp of EMPLOYEES) {
    // Look up Firebase Auth UID by email
    let uid;
    try {
      const userRecord = await auth.getUserByEmail(emp.email);
      uid = userRecord.uid;
    } catch (e) {
      console.error(`User not found: ${emp.email} — skipping`);
      continue;
    }

    console.log(`Seeding ${emp.name} (${uid})`);

    const events = [
      {
        type: "home_in",
        ...GPS.home,
        timestamp: ist(8, 0),
        siteName: null, siteId: null, marketName: null,
      },
      {
        type: "site_in",
        ...GPS.site_gurgaon,
        timestamp: ist(10, 0),
        siteName: "Gurugram Site", siteId: "SITE-GGN-01", marketName: null,
      },
      {
        type: "site_out",
        ...GPS.site_gurgaon,
        timestamp: ist(12, 30),
        siteName: "Gurugram Site", siteId: "SITE-GGN-01", marketName: null,
      },
      {
        type: "site_in",
        ...GPS.site_faridabad,
        timestamp: ist(14, 0),
        siteName: "Faridabad Site", siteId: "SITE-FBD-01", marketName: null,
      },
      {
        type: "site_out",
        ...GPS.site_faridabad,
        timestamp: ist(16, 30),
        siteName: "Faridabad Site", siteId: "SITE-FBD-01", marketName: null,
      },
      {
        type: "home_out",
        ...GPS.home,
        timestamp: ist(18, 30),
        siteName: null, siteId: null, marketName: null,
      },
    ];

    const batch = db.batch();
    const colRef = db.collection(`users/${uid}/attendance`);

    for (const ev of events) {
      const docRef = colRef.doc();
      batch.set(docRef, {
        id:          docRef.id,
        userId:      uid,
        userName:    emp.name,
        employeeId:  emp.employeeId,
        date:        TODAY,
        type:        ev.type,
        timestamp:   ev.timestamp,
        latitude:    ev.lat,
        longitude:   ev.lon,
        siteId:      ev.siteId   || "",
        siteName:    ev.siteName || "",
        marketName:  ev.marketName || "",
        locationName: "",
      });
    }

    await batch.commit();
    console.log(`  ✓ ${events.length} events written`);
  }

  console.log("Done. Force-run the scheduler to see the Conveyance tab populate.");
  process.exit(0);
}

seed().catch((e) => { console.error(e); process.exit(1); });
