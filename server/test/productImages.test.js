const assert = require("node:assert/strict");
const { afterEach, mock, test } = require("node:test");
const { once } = require("node:events");
const express = require("express");
const jwt = require("jsonwebtoken");
const cloudinary = require("cloudinary").v2;

const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Product = require("../models/Product");
const productRoutes = require("../routes/productRoutes");

const productId = "a".repeat(24);
const previousCloudinaryUrl = process.env.CLOUDINARY_URL;
const png = Buffer.from("89504e470d0a1a0a", "hex");

afterEach(() => {
  mock.restoreAll();
  if (previousCloudinaryUrl === undefined) delete process.env.CLOUDINARY_URL;
  else process.env.CLOUDINARY_URL = previousCloudinaryUrl;
});

const startServer = async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/products", productRoutes);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}/api/products`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
};

const mockLogin = (role = "INVENTORY_STAFF") => {
  mock.method(jwt, "verify", () => ({ id: "staff-1" }));
  mock.method(User, "findById", () => ({
    select() { return this; },
    async populate() { return { _id: "staff-1", role, isActive: true, branch: null }; },
  }));
  mock.method(AuditLog, "create", async () => ({}));
};

const productForm = (file = png, type = "image/png") => {
  const body = new FormData();
  body.set("name", "Test drill");
  body.set("sku", "TEST-DRILL");
  body.set("category", "b".repeat(24));
  body.set("costPrice", "100");
  body.set("sellingPrice", "150");
  body.set("unit", "piece");
  if (file) body.set("imageFile", new Blob([file], { type }), "product.png");
  return body;
};

const request = (url, method, body) => fetch(url, {
  method,
  headers: { Authorization: "Bearer test-token" },
  body,
});

test("inventory staff can create a product with a Cloudinary image", async () => {
  process.env.CLOUDINARY_URL = "cloudinary://key:secret@test-cloud";
  mockLogin();
  mock.method(cloudinary.uploader, "upload_stream", (options, done) => {
    assert.equal(options.asset_folder, "hardware-store/products");
    assert.equal(options.public_id_prefix, "hardware-store/products");
    return { end(bytes) {
      assert.deepEqual(bytes, png);
      done(null, { secure_url: "https://res.cloudinary.com/test/image/upload/new.png", public_id: "hardware-store/products/new" });
    } };
  });
  let saved;
  mock.method(Product, "create", async (fields) => {
    saved = fields;
    return { _id: productId, ...fields };
  });

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm());
    assert.equal(result.status, 201);
    assert.equal(saved.image, "https://res.cloudinary.com/test/image/upload/new.png");
    assert.equal(saved.imagePublicId, "hardware-store/products/new");
    assert.equal(saved.name, "Test drill");
  } finally {
    await server.close();
  }
});

test("replacing an image deletes the previous managed asset after saving", async () => {
  process.env.CLOUDINARY_URL = "cloudinary://key:secret@test-cloud";
  mockLogin("MANAGER");
  mock.method(Product, "findById", async () => ({
    image: "https://res.cloudinary.com/test/image/upload/old.png",
    imagePublicId: "hardware-store/products/old",
  }));
  mock.method(cloudinary.uploader, "upload_stream", (_options, done) => ({
    end() { done(null, { secure_url: "https://res.cloudinary.com/test/image/upload/new.png", public_id: "hardware-store/products/new" }); },
  }));
  let updated;
  mock.method(Product, "findByIdAndUpdate", (_id, fields) => {
    updated = fields;
    return { async populate() { return { _id: productId, name: fields.name, sku: fields.sku, image: fields.image, imagePublicId: fields.imagePublicId }; } };
  });
  const deleted = [];
  mock.method(cloudinary.uploader, "destroy", async (id) => { deleted.push(id); return { result: "ok" }; });

  const server = await startServer();
  try {
    const result = await request(`${server.url}/${productId}`, "PUT", productForm());
    assert.equal(result.status, 200);
    assert.equal(updated.imagePublicId, "hardware-store/products/new");
    assert.deepEqual(deleted, ["hardware-store/products/old"]);
  } finally {
    await server.close();
  }
});

test("removing an image clears the database fields and Cloudinary asset", async () => {
  mockLogin("ADMIN");
  mock.method(Product, "findById", async () => ({ image: "old-url", imagePublicId: "hardware-store/products/old" }));
  let updated;
  mock.method(Product, "findByIdAndUpdate", (_id, fields) => {
    updated = fields;
    return { async populate() { return { _id: productId, name: "Test drill", sku: "TEST-DRILL", ...fields }; } };
  });
  const deleted = [];
  mock.method(cloudinary.uploader, "destroy", async (id) => { deleted.push(id); return { result: "ok" }; });
  const body = productForm(null);
  body.set("removeImage", "true");

  const server = await startServer();
  try {
    const result = await request(`${server.url}/${productId}`, "PUT", body);
    assert.equal(result.status, 200);
    assert.equal(updated.image, "");
    assert.equal(updated.imagePublicId, "");
    assert.deepEqual(deleted, ["hardware-store/products/old"]);
  } finally {
    await server.close();
  }
});

test("an invalid image is rejected before Cloudinary or MongoDB writes", async () => {
  process.env.CLOUDINARY_URL = "cloudinary://key:secret@test-cloud";
  mockLogin();
  let wrote = false;
  mock.method(Product, "create", async () => { wrote = true; });
  mock.method(cloudinary.uploader, "upload_stream", () => { throw new Error("should not upload"); });

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm(Buffer.from("not a PNG")));
    assert.equal(result.status, 400);
    assert.equal(wrote, false);
  } finally {
    await server.close();
  }
});

test("an image over 5 MB is rejected before Cloudinary or MongoDB writes", async () => {
  process.env.CLOUDINARY_URL = "cloudinary://key:secret@test-cloud";
  mockLogin();
  let wrote = false;
  mock.method(Product, "create", async () => { wrote = true; });
  mock.method(cloudinary.uploader, "upload_stream", () => { throw new Error("should not upload"); });
  const oversizedImage = Buffer.concat([png, Buffer.alloc(5 * 1024 * 1024)]);

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm(oversizedImage));
    assert.equal(result.status, 400);
    assert.equal((await result.json()).message, "Product images must be 5 MB or smaller.");
    assert.equal(wrote, false);
  } finally {
    await server.close();
  }
});

test("an upload without Cloudinary configuration does not create a product", async () => {
  delete process.env.CLOUDINARY_URL;
  mockLogin();
  let wrote = false;
  mock.method(Product, "create", async () => { wrote = true; });

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm());
    assert.equal(result.status, 503);
    assert.equal(wrote, false);
  } finally {
    await server.close();
  }
});

test("a malformed Cloudinary URL does not crash the API", async () => {
  process.env.CLOUDINARY_URL = "partial-credential";
  mockLogin();
  let wrote = false;
  mock.method(Product, "create", async () => { wrote = true; });

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm());
    assert.equal(result.status, 503);
    assert.match((await result.json()).message, /must begin with cloudinary:\/\//);
    assert.equal(wrote, false);
  } finally {
    await server.close();
  }
});

test("a product can still be created without an image", async () => {
  delete process.env.CLOUDINARY_URL;
  mockLogin();
  let saved;
  mock.method(Product, "create", async (fields) => {
    saved = fields;
    return { _id: productId, ...fields };
  });

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm(null));
    assert.equal(result.status, 201);
    assert.equal(saved.image, undefined);
    assert.equal(saved.imagePublicId, undefined);
  } finally {
    await server.close();
  }
});

test("a failed database save cleans up the newly uploaded image", async () => {
  process.env.CLOUDINARY_URL = "cloudinary://key:secret@test-cloud";
  mockLogin();
  mock.method(cloudinary.uploader, "upload_stream", (_options, done) => ({
    end() { done(null, { secure_url: "https://res.cloudinary.com/test/image/upload/new.png", public_id: "hardware-store/products/new" }); },
  }));
  mock.method(Product, "create", async () => { throw new Error("database unavailable"); });
  const deleted = [];
  mock.method(cloudinary.uploader, "destroy", async (id) => { deleted.push(id); return { result: "ok" }; });

  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm());
    assert.equal(result.status, 500);
    assert.deepEqual(deleted, ["hardware-store/products/new"]);
  } finally {
    await server.close();
  }
});

test("cashiers cannot upload product images", async () => {
  mockLogin("CASHIER");
  const server = await startServer();
  try {
    const result = await request(server.url, "POST", productForm());
    assert.equal(result.status, 403);
  } finally {
    await server.close();
  }
});
