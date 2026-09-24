import { fuseRgbdKeyframes } from "./fusion";
import "./fusion.worker";

jest.mock("./fusion", () => ({ fuseRgbdKeyframes: jest.fn() }));

test("separate areas are reconstructed independently without Area 1 photo-only frames", () => {
  const originalPostMessage = self.postMessage;
  self.postMessage = jest.fn();
  fuseRgbdKeyframes.mockReturnValue({ mesh: null, observations: null, diagnostics: {} });
  try {
    const main = [{ captureId: 1 }];
    const separate = [{ captureId: 2 }, { captureId: 3 }];
    const photos = [{ textureOnly: true }];
    self.onmessage({ data: { keyframes: main, sections: [{ id: 7, keyframes: separate }],
      options: { textureKeyframes: photos, recoverCaptureGroups: true } } });
    expect(fuseRgbdKeyframes).toHaveBeenCalledTimes(2);
    expect(fuseRgbdKeyframes.mock.calls[0][0]).toBe(main);
    expect(fuseRgbdKeyframes.mock.calls[1][0]).toBe(separate);
    expect(fuseRgbdKeyframes.mock.calls[1][1]).toMatchObject({
      textureKeyframes: [], recoverCaptureGroups: false,
    });
    expect(self.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: "complete", result: expect.objectContaining({ sections: [expect.objectContaining({ id: 7 })] }),
    }), []);
  } finally {
    self.postMessage = originalPostMessage;
  }
});
