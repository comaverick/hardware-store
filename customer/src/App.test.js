import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the customer storefront heading", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /everything your project needs/i })).toBeInTheDocument();
});
