// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

// UI tests use a signed-out SDK adapter; they never contact the real Firebase project.
jest.mock('./auth/firebaseAuth', () => ({
  customerAuth: {
    watchUser: (next) => { next(null); return () => {}; },
  },
  authErrorMessage: (error) => error?.message || 'Please try again.',
}));

if (typeof global.TextEncoder === 'undefined') {
  global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  global.TextDecoder = TextDecoder;
}

if (typeof window !== 'undefined') {
  window.scrollTo = jest.fn();
}
