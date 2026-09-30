import {
  DEFAULT_COLOR_LONG_EDGE,
  DEFAULT_COLOR_SHORT_EDGE,
  measureColorFrameQuality,
  createCameraColorReader,
} from "./cameraColor";

test("camera color capture keeps a higher-detail but bounded default", () => {
  expect(DEFAULT_COLOR_LONG_EDGE).toBeGreaterThan(640);
  expect(DEFAULT_COLOR_LONG_EDGE).toBeLessThanOrEqual(1024);
  expect(DEFAULT_COLOR_SHORT_EDGE).toBeLessThan(DEFAULT_COLOR_LONG_EDGE);
});

test("color quality distinguishes detail from a flat frame", () => {
  const flat = new Uint8Array(
    Array(64)
      .fill([120, 120, 120, 255])
      .flat(),
  );
  const checker = new Uint8Array(
    Array.from({ length: 64 }, (_, index) => {
      const value = (index + Math.floor(index / 8)) % 2 ? 30 : 225;
      return [value, value, value, 255];
    }).flat(),
  );
  const flatQuality = measureColorFrameQuality(flat, 8, 8);
  const checkerQuality = measureColorFrameQuality(checker, 8, 8);
  expect(checkerQuality.sharpness).toBeGreaterThan(flatQuality.sharpness);
  expect(checkerQuality.focus).toBeGreaterThan(flatQuality.focus);
  expect(flatQuality.clippedRatio).toBe(0);
});

test("color quality reports clipped camera content", () => {
  const pixels = new Uint8Array(
    Array(16)
      .fill([255, 255, 255, 255])
      .flat(),
  );
  const quality = measureColorFrameQuality(pixels, 4, 4);
  expect(quality.clippedRatio).toBe(1);
  expect(quality.sharpness).toBe(0);
  expect(quality.focus).toBe(0);
});

function cameraGl() {
  const gl = {};
  ["VERTEX_SHADER", "FRAGMENT_SHADER", "COMPILE_STATUS", "LINK_STATUS", "ARRAY_BUFFER",
    "STATIC_DRAW", "FLOAT", "TEXTURE_2D", "TEXTURE_MIN_FILTER", "TEXTURE_MAG_FILTER",
    "LINEAR", "FRAMEBUFFER", "COLOR_ATTACHMENT0", "RGBA", "UNSIGNED_BYTE", "SCISSOR_TEST",
    "DEPTH_TEST", "BLEND", "CULL_FACE", "TEXTURE0", "TRIANGLES"].forEach((name, index) => {
    gl[name] = index + 1;
  });
  gl.NO_ERROR = 0;
  gl.FRAMEBUFFER_COMPLETE = 0x8cd5;
  for (const kind of ["Shader", "Program", "VertexArray", "Buffer", "Texture", "Framebuffer"]) {
    gl[`create${kind}`] = jest.fn(() => ({ kind }));
    gl[`delete${kind}`] = jest.fn();
  }
  for (const name of ["shaderSource", "compileShader", "attachShader", "linkProgram",
    "bindVertexArray", "bindBuffer", "bufferData", "enableVertexAttribArray", "vertexAttribPointer",
    "bindTexture", "texParameteri", "bindFramebuffer", "framebufferTexture2D", "texImage2D",
    "viewport", "disable", "colorMask", "useProgram", "activeTexture", "uniform1i", "drawArrays"])
    gl[name] = jest.fn();
  gl.getShaderParameter = jest.fn(() => true);
  gl.getProgramParameter = jest.fn(() => true);
  gl.getAttribLocation = jest.fn(() => 0);
  gl.getUniformLocation = jest.fn(() => ({}));
  gl.isContextLost = jest.fn(() => false);
  gl.checkFramebufferStatus = jest.fn(() => gl.FRAMEBUFFER_COMPLETE);
  gl.getError = jest.fn(() => gl.NO_ERROR);
  gl.readPixels = jest.fn((x, y, width, height, format, type, pixels) => pixels.fill(120));
  return gl;
}

test.each(["shader", "program", "framebuffer"])("failed %s setup releases earlier camera resources", (stage) => {
  const gl = cameraGl();
  if (stage === "shader") gl.getShaderParameter.mockReturnValueOnce(true).mockReturnValueOnce(false);
  if (stage === "program") gl.getProgramParameter.mockReturnValue(false);
  if (stage === "framebuffer") gl.framebufferTexture2D.mockImplementation(() => { throw new Error("failed framebuffer"); });
  expect(() => createCameraColorReader(gl)).toThrow();
  expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  if (stage !== "shader") expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  if (stage === "framebuffer") {
    expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  }
});

test.each(["framebuffer", "readback", "context"])("invalid %s never returns a color observation", (stage) => {
  const gl = cameraGl();
  const reader = createCameraColorReader(gl);
  if (stage === "framebuffer") gl.checkFramebufferStatus.mockReturnValue(0x8cd6);
  if (stage === "readback") gl.getError.mockReturnValue(0x0502);
  if (stage === "context") gl.isContextLost.mockReturnValue(true);
  const binding = { getCameraImage: jest.fn(() => ({})) };
  expect(() => reader.read(binding, { width: 4, height: 4 })).toThrow();
  if (stage === "context") expect(binding.getCameraImage).not.toHaveBeenCalled();
  reader.dispose();
});

test("camera disposal continues after one resource fails and is repeatable", () => {
  const gl = cameraGl();
  const reader = createCameraColorReader(gl);
  gl.deleteFramebuffer.mockImplementation(() => { throw new Error("framebuffer already gone"); });
  expect(() => reader.dispose()).toThrow("framebuffer already gone");
  expect(gl.deleteTexture).toHaveBeenCalledTimes(1);
  expect(gl.deleteProgram).toHaveBeenCalledTimes(1);
  expect(gl.deleteBuffer).toHaveBeenCalledTimes(1);
  expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  expect(() => reader.dispose()).not.toThrow();
  expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(1);
});

test("a healthy camera copy keeps its pixel orientation and an owned snapshot", () => {
  const gl = cameraGl();
  gl.readPixels.mockImplementation((x, y, width, height, format, type, pixels) => {
    for (let row = 0; row < height; row++) for (let column = 0; column < width; column++)
      pixels.set([row * 40 + 10, column * 30 + 20, 120, 255], (row * width + column) * 4);
  });
  const reader = createCameraColorReader(gl);
  const binding = { getCameraImage: () => ({}) };
  const color = reader.read(binding, { width: 4, height: 4 });
  expect(color(0, 0)).toEqual([130, 20, 120]);
  expect(color(1, 1)).toEqual([10, 110, 120]);
  const saved = color.snapshot();
  gl.readPixels.mockImplementation((x, y, width, height, format, type, pixels) => pixels.fill(0));
  reader.read(binding, { width: 4, height: 4 });
  expect(saved).toMatchObject({ width: 4, height: 4, channels: 4 });
  expect(saved.data[0]).toBe(10);
  reader.dispose();
});
