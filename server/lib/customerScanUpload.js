const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createWriteStream } = require("node:fs");
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { storageError } = require("./customerScanStorage");

function createCustomerScanUpload({ directory = process.env.SCANSPACE_TEMP_DIR || path.join(os.tmpdir(), "hardware-store-scanspace"), freeSpace = fs.statfs } = {}) {
  const remove = async filePath => { if (filePath) await fs.unlink(filePath).catch(error => { if (error.code !== "ENOENT") throw error; }); };
  return {
    async _handleFile(req, file, callback) {
      let filePath;
      let aborted;
      try {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const checkSpace = async () => {
          const stats = await freeSpace(directory);
          if (stats.bavail * stats.bsize < 100 * 1024 * 1024)
            throw storageError("The server has insufficient temporary disk space. Please try again later.", 507);
        };
        await checkSpace();
        filePath = path.join(directory, `${crypto.randomUUID()}.part`);
        const hash = crypto.createHash("sha256");
        let size = 0, checkedAt = 0, prefixSize = 0;
        const prefix = [];
        const inspect = new Transform({
          transform(bytes, encoding, next) {
            size += bytes.length;
            if (size > req.scanStorageRemaining) return next(storageError("The included scan storage is full. Remove older saves to make space.", 507));
            hash.update(bytes);
            if (prefixSize < 65536) { const part = bytes.subarray(0, 65536 - prefixSize); prefix.push(Buffer.from(part)); prefixSize += part.length; }
            if (size - checkedAt < 8 * 1024 * 1024) return next(null, bytes);
            checkedAt = size;
            checkSpace().then(() => next(null, bytes), next);
          },
        });
        aborted = () => inspect.destroy(storageError("The scan upload was cancelled.", 400));
        req.once("aborted", aborted);
        await pipeline(file.stream, inspect, createWriteStream(filePath, { flags: "wx", mode: 0o600 }));
        callback(null, { path: filePath, size, sha256: hash.digest("hex"), beginning: Buffer.concat(prefix).toString("utf8") });
      } catch (error) {
        if (filePath) await remove(filePath).catch(() => {});
        callback(error.code === "ENOSPC" ? storageError("The server has insufficient temporary disk space.", 507) : error);
      } finally { if (aborted) req.removeListener("aborted", aborted); }
    },
    _removeFile(req, file, callback) { remove(file.path).then(() => callback(null), callback); },
    remove,
  };
}

module.exports = { createCustomerScanUpload };
