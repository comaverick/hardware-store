const previousApiUrl = process.env.REACT_APP_API_URL;

afterEach(() => {
  if (previousApiUrl === undefined) delete process.env.REACT_APP_API_URL;
  else process.env.REACT_APP_API_URL = previousApiUrl;
});

const assetResolver = (baseUrl = "http://localhost:5000") => {
  process.env.REACT_APP_API_URL = baseUrl;
  let resolve;
  jest.isolateModules(() => {
    resolve = require("./api").resolveApiAssetUrl;
  });
  return resolve;
};

test.each([
  "http://localhost:5000",
  "http://localhost:5000/api/",
  "https://hardware-store-nffe.onrender.com",
  "https://hardware-store-nffe.onrender.com/api",
])("loads ScanSpace images from the configured API server (%s)", (baseUrl) => {
  const resolve = assetResolver(baseUrl);
  const origin = new URL(baseUrl).origin;
  expect(resolve("/assets/scanspace/paint-sage.png"))
    .toBe(`${origin}/assets/scanspace/paint-sage.png`);
  expect(resolve("assets/scanspace/floor-light-vinyl.png"))
    .toBe(`${origin}/assets/scanspace/floor-light-vinyl.png`);
});

test.each([
  "https://res.cloudinary.com/store/image/upload/v123/paint.png?signature=test",
  "blob:http://localhost:3000/product-preview",
  "data:image/png;base64,iVBORw0KGgo=",
])("preserves existing image and upload preview URLs (%s)", (image) => {
  expect(assetResolver()(image)).toBe(image);
});

test.each([undefined, null, "", "   ", "http://[invalid", "javascript:alert(1)"])(
  "returns no image for an absent or invalid source (%s)",
  (image) => expect(assetResolver()(image)).toBe(""),
);
