const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createCustomerScanRouter } = require("../routes/customerScanRoutes");
const { createCustomerScanStorage, CHUNK_BYTES } = require("../lib/customerScanStorage");
const { createCustomerScanUpload } = require("../lib/customerScanUpload");
const { rectangle } = require("../lib/scanspaceDomain");

const clone = value => value == null ? value : structuredClone(value);
function matches(record, filter) {
  return record && Object.entries(filter).every(([key, value]) => {
    if (key === "$or") return value.some(option => matches(record, option));
    if (value && typeof value === "object" && !(value instanceof Date)) {
      if ("$lte" in value) return record[key] <= value.$lte;
      if ("$in" in value) return value.$in.includes(record[key]);
    }
    return record[key] === value;
  });
}
const query = value => ({ sort() { return this; }, limit() { return this; }, session() { return this; }, then(resolve, reject) { return Promise.resolve(clone(value)).then(resolve, reject); } });
const update = (record, changes) => {
  Object.assign(record, changes.$set);
  for (const [key, amount] of Object.entries(changes.$inc || {})) record[key] = (record[key] || 0) + amount;
  for (const key of Object.keys(changes.$unset || {})) delete record[key];
  record.updatedAt = new Date();
};
const original = () => Buffer.from(JSON.stringify({ ...rectangle(), name: "Bedroom" }));

async function fixture(t, options = {}) {
  const records = new Map(), objects = new Map(), verifications = [], cloudCalls = [];
  let budget = { _id: "supabase-scanspace", usedBytes: 0 }, sequence = 0, confirmFailure = options.confirmFailure;
  const model = {
    async createIndexes() {},
    find: filter => query([...records.values()].filter(record => matches(record, filter))),
    findOne: filter => query([...records.values()].find(record => matches(record, filter))),
    async create(values) {
      return values.map(value => {
        assert.equal([...records.values()].some(record => record.ownerUid === value.ownerUid && record.requestKey === value.requestKey), false);
        const record = { ...clone(value), _id: (++sequence).toString(16).padStart(24, "0"), revision: 1, createdAt: new Date(), updatedAt: new Date() };
        records.set(record._id, record);
        return clone(record);
      });
    },
    async findOneAndUpdate(filter, changes) {
      const record = [...records.values()].find(record => matches(record, filter));
      if (!record) return null;
      update(record, changes);
      if (changes.$set?.status === "ready" && confirmFailure) { confirmFailure = false; throw new Error("Confirmation lost after commit"); }
      return clone(record);
    },
    async updateOne(filter, changes) {
      const record = [...records.values()].find(record => matches(record, filter));
      if (!record) return { matchedCount: 0 };
      update(record, changes); return { matchedCount: 1 };
    },
    findOneAndDelete(filter) {
      const record = [...records.values()].find(record => matches(record, filter));
      if (record) records.delete(record._id);
      return query(record);
    },
  };
  const budgetModel = {
    async createIndexes() {},
    findById: () => query(budget),
    async updateOne(filter, changes) { update(budget, changes); return { matchedCount: 1 }; },
    async findOneAndUpdate(filter, changes) { if (!matches(budget, filter)) return null; update(budget, changes); return clone(budget); },
  };
  const sdk = {
    storage: {
      async getBucket() { return { data: { public: options.publicBucket || false }, error: null }; },
      from() { return {
        async upload(key, data, settings) {
          cloudCalls.push({ operation: "upload", key, size: data.length, upsert: settings.upsert });
          if (options.uploadFailure?.()) return { error: { statusCode: "503" } };
          if (objects.has(key)) return { error: { statusCode: "409" } };
          objects.set(key, Buffer.from(data)); return { data: { path: key }, error: null };
        },
        async download(key) { cloudCalls.push({ operation: "download", key }); return { data: objects.has(key) ? new Blob([objects.get(key)]) : null, error: objects.has(key) ? null : { statusCode: "404" } }; },
        async remove(keys) {
          if (options.deleteFailure?.()) return { error: { statusCode: "503" } };
          for (const key of keys) objects.delete(key);
          return { data: [], error: null };
        },
      }; },
    },
  };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "scanspace-account-test-"));
  t.after(async () => { assert.equal(path.dirname(directory), os.tmpdir()); await fs.rm(directory, { recursive: true, force: true }); });
  const staging = createCustomerScanUpload({ directory, freeSpace: async () => ({ bavail: 1024 ** 3, bsize: 1024 }) });
  let transactionTail = Promise.resolve();
  const transaction = work => {
    const result = transactionTail.then(() => work(null));
    transactionTail = result.catch(() => {}); return result;
  };
  const storage = createCustomerScanStorage({ client: sdk });
  const app = express(); app.use(express.json({ limit: "8mb" }));
  app.use("/api/customer-scans", createCustomerScanRouter({
    ScanModel: model, BudgetModel: budgetModel, storage, staging, transaction, capacity: options.capacity || 1000000000,
    CustomerModel: { findOne: async filter => ({ firebaseUid: filter.firebaseUid, isActive: !options.disabled }) },
    getAuth: () => ({ async verifyIdToken(token, checkRevoked) {
      verifications.push({ token, checkRevoked });
      if (token === "revoked") throw Object.assign(new Error("Revoked"), { code: "auth/id-token-revoked" });
      return { uid: token, email: `${token}@example.com`, email_verified: !options.unverified, firebase: { sign_in_provider: "google.com" } };
    } }),
  }));
  const server = await new Promise(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const endpoint = `http://127.0.0.1:${server.address().port}/api/customer-scans`;
  async function request({ method = "GET", suffix = "", token = "alex", body, bytes, key = "original-file-key", metadata } = {}) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    if (bytes) {
      body = new FormData(); body.append("metadata", JSON.stringify(metadata || { kind: "room", name: "Bedroom", room: rectangle() }));
      body.append("file", new Blob([bytes], { type: "application/json" }), "scan.json");
      headers["Idempotency-Key"] = key;
    } else if (body) { headers["Content-Type"] = "application/json"; body = JSON.stringify(body); }
    const response = await fetch(endpoint + suffix, { method, headers, body });
    const result = suffix.endsWith("/file") && response.ok ? Buffer.from(await response.arrayBuffer()) : response.status === 204 ? null : await response.json();
    return { status: response.status, body: result, cache: response.headers.get("cache-control") };
  }
  return { request, records, objects, budget: () => budget.usedBytes, directory, storage, cloudCalls, verifications };
}

test("account scans require verified, active, revocation-checked Firebase identities before upload", async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ token: null })).status, 401);
  assert.equal((await f.request({ token: "revoked" })).status, 401);
  assert.equal(f.records.size, 0); assert.equal(f.cloudCalls.length, 0);
  assert.equal(f.verifications[0].checkRevoked, true);
  const unverified = await fixture(t, { unverified: true });
  assert.equal((await unverified.request()).status, 403);
  const disabled = await fixture(t, { disabled: true });
  assert.equal((await disabled.request()).status, 403);
});

test("owners save/reopen exact original bytes; another account cannot list, read, edit, or delete them", async t => {
  const f = await fixture(t), bytes = original();
  const created = await f.request({ method: "POST", bytes });
  assert.equal(created.status, 201); assert.equal(created.cache, "no-store");
  const record = created.body.scan, suffix = `/${record.id}`;
  assert.equal(record.ownerUid, undefined); assert.equal(record.storagePath, undefined);
  assert.equal(f.records.get(record.id).ownerUid, "alex");
  assert.deepEqual((await f.request({ suffix: suffix + "/file" })).body, bytes);
  assert.equal((await f.request({ token: "other" })).body.scans.length, 0);
  for (const method of ["GET", "PATCH", "DELETE"])
    assert.equal((await f.request({ token: "other", method, suffix, body: method === "PATCH" ? { name: "Hijacked", ownerUid: "alex", revision: 1, room: rectangle() } : undefined })).status, 404);
  assert.equal((await f.request({ token: "other", suffix: suffix + "/file" })).status, 404);
  assert.equal((await f.request({ suffix: "/..%2Foutside" })).status, 404);
  assert.equal(f.objects.size, 1);
});

test("a logical scan over 64 MB streams through multipart and reassembles chunks below the provider limit", async t => {
  const f = await fixture(t);
  const bytes = Buffer.alloc(65 * 1024 * 1024 + 37, 32); original().copy(bytes);
  const created = await f.request({ method: "POST", bytes });
  assert.equal(created.status, 201);
  assert.equal(created.body.scan.byteSize, bytes.length);
  const uploads = f.cloudCalls.filter(call => call.operation === "upload");
  assert.ok(uploads.length > 1); assert.ok(uploads.every(call => call.size <= CHUNK_BYTES && call.upsert === false));
  const downloaded = await f.request({ suffix: `/${created.body.scan.id}/file` });
  assert.equal(downloaded.status, 200);
  const digest = value => crypto.createHash("sha256").update(value).digest("hex");
  assert.equal(digest(downloaded.body), digest(bytes));
  assert.equal(f.budget(), bytes.length);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("finish and room edits use revisions and preserve the original file digest", async t => {
  const f = await fixture(t), bytes = original();
  const { body } = await f.request({ method: "POST", bytes });
  const record = body.scan;
  const edited = await f.request({ method: "PATCH", suffix: `/${record.id}`, body: { revision: 1, name: "Renamed room", room: rectangle(6, 4, 2.8), byteSize: 1, sha256: "replaced", ownerUid: "other" } });
  assert.equal(edited.status, 200); assert.equal(edited.body.scan.revision, 2);
  assert.equal(edited.body.scan.name, "Renamed room"); assert.equal(edited.body.scan.sha256, record.sha256);
  assert.deepEqual((await f.request({ suffix: `/${record.id}/file` })).body, bytes);
  assert.equal((await f.request({ method: "PATCH", suffix: `/${record.id}`, body: { revision: 1, name: "Stale", room: rectangle() } })).status, 409);
  assert.equal(f.cloudCalls.filter(call => call.operation === "upload").length, 1);
});

test("interrupted saves keep their storage reservation, resume without overwriting chunks, and recover lost confirmations", async t => {
  let failUpload = true;
  const f = await fixture(t, { uploadFailure: () => failUpload, confirmFailure: true });
  t.mock.method(console, "error", () => {});
  const bytes = original();
  assert.equal((await f.request({ method: "POST", bytes })).status, 503);
  assert.equal(f.budget(), bytes.length);
  assert.equal((await f.request()).body.scans[0].status, "incomplete");
  failUpload = false;
  const metadata = { kind: "room", name: "Resumed bedroom", room: rectangle(6, 4, 2.8) };
  assert.equal((await f.request({ method: "POST", bytes, metadata })).status, 503);
  const replay = await f.request({ method: "POST", bytes });
  assert.equal(replay.status, 200); assert.equal(replay.body.scan.status, "ready");
  assert.equal(replay.body.scan.name, "Resumed bedroom");
  assert.equal(replay.body.scan.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(f.records.size, 1); assert.equal(f.budget(), bytes.length);
  assert.equal((await f.request({ method: "POST", bytes: Buffer.concat([bytes, Buffer.from(" ")]) })).status, 409);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("private buckets and total free storage are enforced without imposing a per-scan size cap", async t => {
  const bytes = original();
  const publicBucket = await fixture(t, { publicBucket: true });
  assert.equal((await publicBucket.request({ method: "POST", bytes })).status, 503);
  assert.equal(publicBucket.objects.size, 0);
  const f = await fixture(t, { capacity: bytes.length });
  assert.equal((await f.request({ method: "POST", bytes })).status, 201);
  assert.equal((await f.request({ method: "POST", bytes, key: "another-file-key" })).status, 507);
  assert.equal(f.records.size, 1); assert.equal(f.budget(), bytes.length);
  assert.deepEqual(await fs.readdir(f.directory), []);
});

test("deleting all original chunks and releasing total storage is retriable and restricted to their owner", async t => {
  let failDelete = true;
  const f = await fixture(t, { deleteFailure: () => failDelete });
  const bytes = original(); const { body } = await f.request({ method: "POST", bytes });
  const suffix = `/${body.scan.id}`;
  assert.equal((await f.request({ method: "DELETE", suffix })).status, 503);
  assert.equal(f.budget(), bytes.length); assert.equal(f.records.size, 1);
  failDelete = false;
  assert.equal((await f.request({ method: "DELETE", suffix })).status, 204);
  assert.equal(f.objects.size, 0); assert.equal(f.records.size, 0); assert.equal(f.budget(), 0);
});

test("tampered or missing original chunks fail their integrity check", async t => {
  const f = await fixture(t), bytes = original();
  const { body } = await f.request({ method: "POST", bytes });
  const record = f.records.get(body.scan.id);
  const key = [...f.objects.keys()][0];
  f.objects.set(key, Buffer.alloc(bytes.length));
  await assert.rejects(async () => { for await (const part of f.storage.download(record)) assert.ok(part); }, /integrity check/);
  f.objects.delete(key);
  await assert.rejects(async () => { for await (const part of f.storage.download(record)) assert.ok(part); }, /could not be downloaded/);
});
