/* eslint-disable no-restricted-globals */
import { reconstructRoom } from "./reconstruction";
self.onmessage = (event) => {
  try {
    self.postMessage({
      result: reconstructRoom(event.data.points, event.data.options),
    });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
