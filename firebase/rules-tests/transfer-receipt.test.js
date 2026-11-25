"use strict";

/**
 * Receipt confirmation on material/tool transfers: the named receiver may read the sender's
 * transfer and change only its receipt fields. Nobody else gains anything.
 */

const { test, before, after, beforeEach } = require("node:test");
const {
  setup, teardown, seedUsers, seedDocs, asUser, assertSucceeds, assertFails,
} = require("./helpers");
const { Timestamp } = require("firebase/firestore");

let env;
const COLLECTIONS = ["material_transfers", "tool_transfers"];
const transfer = (extra = {}) => ({
  userId: "sender", receiverId: "receiver", receiptStatus: "pending",
  items: [{ itemName: "Drill", quantity: 1 }], ...extra,
});
const path = (col, id = "t1") => `users/sender/${col}/${id}`;
const receipt = (status, extra = {}) => ({
  receiptStatus: status, receiptAt: Timestamp.now(), ...extra,
});

before(async () => {
  env = await setup();
  await seedUsers(env, {
    sender: {}, receiver: {}, stranger: {}, gone: { active: false },
  });
});
after(async () => { await teardown(); });

beforeEach(async () => {
  const docs = {};
  for (const col of COLLECTIONS) {
    docs[path(col)] = transfer();
    docs[path(col, "done")] = transfer({ receiptStatus: "received" });
    docs[path(col, "bad")] = transfer({ receiptStatus: "problem", receiptNote: "one missing" });
    docs[path(col, "gone")] = transfer({ receiverId: "gone" });
    docs[path(col, "old")] = { userId: "sender" };
  }
  await seedDocs(env, docs);
});

for (const col of COLLECTIONS) {
  const doc = (uid, id) => asUser(env, uid).doc(path(col, id));
  const incoming = (uid, receiverId) =>
    asUser(env, uid).collectionGroup(col).where("receiverId", "==", receiverId).get();

  test(`${col}: only the receiver can read and list what was sent to them`, async () => {
    await assertSucceeds(doc("receiver").get());
    await assertSucceeds(incoming("receiver", "receiver"));
    await assertFails(doc("stranger").get());
    await assertFails(incoming("stranger", "receiver"));
    await assertFails(doc("receiver", "old").get());
  });

  test(`${col}: receiver confirms, or reports a problem then confirms`, async () => {
    await assertSucceeds(doc("receiver").update(receipt("received", { lastModifiedBy: "receiver" })));
    await assertSucceeds(doc("receiver", "bad").update(receipt("received")));
    await seedDocs(env, { [path(col)]: transfer() });
    await assertSucceeds(doc("receiver").update(receipt("problem", { receiptNote: "damaged" })));
  });

  test(`${col}: nobody but the receiver can confirm`, async () => {
    await assertFails(doc("sender").update(receipt("received")));
    await assertFails(doc("stranger").update(receipt("received")));
    await assertFails(doc("gone", "gone").update(receipt("received")));
  });

  test(`${col}: receiver cannot touch anything but the receipt`, async () => {
    await assertFails(doc("receiver").update(receipt("received", { items: [] })));
    await assertFails(doc("receiver").update({ receiverId: "stranger" }));
    await assertFails(doc("receiver").update(receipt("received", { lastModifiedBy: "sender" })));
  });

  test(`${col}: bad transitions and payloads are refused`, async () => {
    await assertFails(doc("receiver", "done").update(receipt("problem", { receiptNote: "late" })));
    await assertFails(doc("receiver", "done").update(receipt("received")));
    await assertFails(doc("receiver").update(receipt("pending")));
    await assertFails(doc("receiver").update(receipt("problem")));
    await assertFails(doc("receiver").update(receipt("problem", { receiptNote: "" })));
    await assertFails(doc("receiver").update({ receiptStatus: "received", receiptAt: "now" }));
  });

  test(`${col}: a transfer cannot be born confirmed or addressed to its sender`, async () => {
    await assertSucceeds(doc("sender", "new1").set(transfer()));
    await assertSucceeds(doc("sender", "new2").set({ userId: "sender" })); // old app builds
    await assertFails(doc("sender", "new3").set(transfer({ receiptStatus: "received" })));
    await assertFails(doc("sender", "new4").set(transfer({ receiptAt: Timestamp.now() })));
    await assertFails(doc("sender", "new5").set(transfer({ receiptNote: "x" })));
    await assertFails(doc("sender", "new6").set(transfer({ receiverId: "sender" })));
  });
}

test("directory: any signed-in user reads it, no employee writes it", async () => {
  await seedDocs(env, { "directory/receiver": { name: "R", employeeId: "E1", active: true } });
  const db = asUser(env, "sender");
  await assertSucceeds(db.collection("directory").get());
  await assertFails(db.doc("directory/sender").set({ name: "Boss" }));
  await assertFails(env.unauthenticatedContext().firestore().doc("directory/receiver").get());
});
