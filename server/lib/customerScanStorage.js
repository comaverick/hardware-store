const crypto = require("node:crypto");
const { open } = require("node:fs/promises");
const { createClient } = require("@supabase/supabase-js");

// Each object is below Supabase Free's object limit. A scan may use many objects.
const CHUNK_BYTES = 5 * 1024 * 1024;
const storageError = (message, status = 503) => Object.assign(new Error(message), { status });

function createCustomerScanStorage({ client, bucket = process.env.SUPABASE_STORAGE_BUCKET || "scanspace" } = {}) {
  let configuredClient = client;
  function getClient() {
    if (configuredClient) return configuredClient;
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw storageError("Scan storage setup is pending. Add the Supabase secret key to the server configuration.");
    const endpoint = new URL(url);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password)
      throw storageError("Configure a valid HTTPS Supabase project URL.");
    configuredClient = createClient(endpoint.origin, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, options) => fetch(input, { ...options, signal: options?.signal || AbortSignal.timeout(120000) }) },
    });
    return configuredClient;
  }
  const chunkCount = record => Math.ceil(record.byteSize / record.chunkSize);
  const objectPath = (record, index) => {
    const owner = crypto.createHash("sha256").update(record.ownerUid).digest("hex");
    return `accounts/${owner}/${record._id}/${String(index).padStart(6, "0")}.bin`;
  };
  async function assertReady() {
    const { data, error } = await getClient().storage.getBucket(bucket);
    if (error || !data) throw storageError("Scan storage is unavailable. Check the secret key and create the scanspace bucket.");
    if (data.public !== false) throw storageError("The scanspace bucket must be private before account files can be saved.");
    if (data.file_size_limit && data.file_size_limit < CHUNK_BYTES)
      throw storageError("Set the bucket's object limit to at least 5 MiB (5,242,880 bytes).");
    if (data.allowed_mime_types?.length && !data.allowed_mime_types.some(type => ["application/octet-stream", "application/*", "*/*"].includes(type)))
      throw storageError("Allow application/octet-stream in the scanspace bucket settings.");
  }
  async function upload(record, filePath, renewLease = async () => {}) {
    const file = await open(filePath, "r");
    try {
      for (let index = 0; index < chunkCount(record); index++) {
        const offset = index * record.chunkSize;
        const length = Math.min(record.chunkSize, record.byteSize - offset);
        const buffer = Buffer.allocUnsafe(length);
        let position = 0;
        while (position < length) {
          const { bytesRead } = await file.read(buffer, position, length - position, offset + position);
          if (!bytesRead) throw storageError("The original scan file could not be read.");
          position += bytesRead;
        }
        await renewLease();
        const { error } = await getClient().storage.from(bucket).upload(objectPath(record, index), buffer, {
          contentType: "application/octet-stream", upsert: false, cacheControl: "0",
        });
        // Retries use the same verified original digest and immutable object paths.
        if (error && !["409", "Duplicate", "AssetAlreadyExists"].includes(String(error.statusCode || error.error || error.code)))
          throw storageError("The scan upload was interrupted. Retry saving to continue, or remove the incomplete save.");
      }
    } finally { await file.close(); }
  }
  async function* download(record) {
    const hash = crypto.createHash("sha256");
    for (let index = 0; index < chunkCount(record); index++) {
      const { data, error } = await getClient().storage.from(bucket).download(objectPath(record, index));
      if (error || !data) throw storageError("The saved original could not be downloaded. Please try again.");
      const bytes = Buffer.from(await data.arrayBuffer());
      const expected = Math.min(record.chunkSize, record.byteSize - index * record.chunkSize);
      if (bytes.length !== expected) throw storageError("The saved original is incomplete.");
      hash.update(bytes);
      if (index === chunkCount(record) - 1 && hash.digest("hex") !== record.sha256)
        throw storageError("The saved original failed its integrity check.");
      yield bytes;
    }
  }
  async function remove(record) {
    const paths = Array.from({ length: chunkCount(record) }, (_, index) => objectPath(record, index));
    for (let offset = 0; offset < paths.length; offset += 100) {
      const { error } = await getClient().storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (error) throw storageError("The scan could not be removed. Please try again.");
    }
  }
  return { assertReady, upload, download, remove, chunkSize: CHUNK_BYTES };
}

module.exports = { createCustomerScanStorage, CHUNK_BYTES, storageError };
