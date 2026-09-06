// Copy the frame-scoped opaque XR camera texture into our own small render target.
// Never attach the opaque texture to a framebuffer or retain it past the XR frame.
export function createCameraColorReader(gl) {
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
    framebuffer = gl.createFramebuffer(),
    size = 256,
    pixels = new Uint8Array(size * size * 4);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    size,
    size,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
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
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.viewport(0, 0, size, size);
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
      gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindVertexArray(null);
      const sample = (u, v) => {
        const i =
          (Math.min(size - 1, Math.floor((1 - v) * size)) * size +
            Math.min(size - 1, Math.floor(u * size))) *
          4;
        return [pixels[i], pixels[i + 1], pixels[i + 2]];
      };
      // The XR camera texture is frame-scoped. A selected keyframe must own a
      // copy so it can be projected onto the final mesh after the session ends.
      sample.snapshot = () => ({
        data: new Uint8Array(pixels),
        width: size,
        height: size,
        channels: 4,
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
