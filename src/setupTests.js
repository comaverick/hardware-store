import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "util";

// React Router expects these browser APIs; the Jest DOM does not supply them.
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
