// Copy the frame-scoped opaque XR camera texture into our own render target.
// Never attach the opaque texture to a framebuffer or retain it past the XR frame.
// A little more source detail materially improves shelf edges and text while
// staying below the portable-export limits used by ScanSpace.
export const DEFAULT_COLOR_LONG_EDGE = 720;
export const DEFAULT_COLOR_SHORT_EDGE = 360;

export function measureColorFrameQuality(
  pixels,
  width,
  height,
  channels = 4,
) {
  if (!pixels?.length || width < 3 || height < 3 || channels < 3)
    return { sharpness: 0, focus: 0, clippedRatio: 1, samples: 0 };
  const luminanceAt = (x, y) => {
    const offset = (y * width + x) * channels;
    return (
      pixels[offset] * 0.2126 +
      pixels[offset + 1] * 0.7152 +
      pixels[offset + 2] * 0.0722
    );
  };
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96));
  let detail = 0;
  let focus = 0;
  let clipped = 0;
  let samples = 0;
  for (let y = 1; y < height - 1; y += step)
    for (let x = 1; x < width - 1; x += step) {
      const center = luminanceAt(x, y);
      const left = luminanceAt(x - 1, y);
      const right = luminanceAt(x + 1, y);
      const above = luminanceAt(x, y - 1);
      const below = luminanceAt(x, y + 1);
      detail +=
        Math.abs(left - center) +
        Math.abs(right - center) +
        Math.abs(above - center) +
        Math.abs(below - center);
      // First derivatives can rate a broad motion-blurred edge as detailed.
      // Laplacian energy measures the high-frequency detail that survives
      // only when the live camera is actually in focus.
      focus += Math.abs(center * 4 - left - right - above - below);
      if (center < 6 || center > 249) clipped++;
      samples++;
    }
  return {
    sharpness: samples ? detail / samples : 0,
    focus: samples && focus > 1e-9 ? focus / samples : 0,
    clippedRatio: samples ? clipped / samples : 1,
    samples,
  };
}

export function createCameraColorReader(gl, options = {}) {
  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      throw new Error("Camera copy shader failed.");
    return s;
  };
  const vs = compile(
    gl.VERTEX_SHADER,
    "#version 300 es\nin vec2 position;out vec2 uv;void main(){uv=(position+1.0)*0.5;gl_Position=vec4(position,0.0,1.0);}",
  );
  const fs = compile(
    gl.FRAGMENT_SHADER,
    "#version 300 es\nprecision mediump float;uniform sampler2D image;in vec2 uv;out vec4 outColor;void main(){outColor=texture(image,uv);}",
  );
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error("Camera copy program failed.");
  const vao = gl.createVertexArray(),
    buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const location = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const texture = gl.createTexture(),
    framebuffer = gl.createFramebuffer();
  let width = 0,
    height = 0,
    pixels = null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return {
    read(binding, camera) {
      const external = binding.getCameraImage(camera);
      if (!external) return null;
      const sourceWidth = Number(camera.width) || 1;
      const sourceHeight = Number(camera.height) || 1;
      const landscape = sourceWidth >= sourceHeight;
      // Preserve enough camera detail for wall labels, trim, and straight
      // edges. Fusion still bounds the number of retained keyframes, and the
      // worker has a lower-memory retry profile for constrained phones.
      const textureLongEdge = Math.max(
        320,
        Math.min(1024, Number(options.longEdge) || DEFAULT_COLOR_LONG_EDGE),
      );
      const textureShortEdge = Math.max(
        160,
        Math.min(
          textureLongEdge,
          Number(options.shortEdge) || DEFAULT_COLOR_SHORT_EDGE,
        ),
      );
      const sourceLongEdge = Math.max(sourceWidth, sourceHeight);
      const sourceShortEdge = Math.min(sourceWidth, sourceHeight);
      const outputLongEdge = Math.min(textureLongEdge, sourceLongEdge);
      const outputShortEdge = Math.min(textureShortEdge, sourceShortEdge);
      const nextWidth = landscape
        ? outputLongEdge
        : Math.max(
            outputShortEdge,
            Math.round((outputLongEdge * sourceWidth) / sourceHeight),
          );
      const nextHeight = landscape
        ? Math.max(
            outputShortEdge,
            Math.round((outputLongEdge * sourceHeight) / sourceWidth),
          )
        : outputLongEdge;
      if (width !== nextWidth || height !== nextHeight) {
        width = nextWidth;
        height = nextHeight;
        pixels = new Uint8Array(width * height * 4);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          width,
          height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          null,
        );
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, width, height);
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      gl.colorMask(true, true, true, true);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, external);
      gl.uniform1i(gl.getUniformLocation(program, "image"), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindVertexArray(null);
      const sample = (u, v) => {
        // WebXR normalized view coordinates are top-left based, while
        // readPixels returns the camera copy from the OpenGL bottom row.
        // Use pixel centres so depth/color samples do not drift by a row or
        // column at the image boundary.
        const i =
          (Math.min(
            height - 1,
            Math.max(0, Math.round((1 - v) * (height - 1))),
          ) *
            width +
            Math.min(
              width - 1,
              Math.max(0, Math.round(u * (width - 1))),
            )) *
          4;
        return [pixels[i], pixels[i + 1], pixels[i + 2]];
      };
      const quality = measureColorFrameQuality(pixels, width, height, 4);
      sample.quality = quality;
      sample.sharpness = quality.sharpness;
      sample.focus = quality.focus;
      sample.clippedRatio = quality.clippedRatio;
      // The XR camera texture is frame-scoped. A selected keyframe must own a
      // copy so it can be projected onto the final mesh after the session ends.
      sample.snapshot = () => ({
        data: new Uint8Array(pixels),
        width,
        height,
        channels: 4,
        sharpness: quality.sharpness,
        focus: quality.focus,
        clippedRatio: quality.clippedRatio,
      });
      return sample;
    },
    dispose() {
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
