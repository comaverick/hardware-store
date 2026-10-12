import { fireEvent, render, screen } from "@testing-library/react";
import ProductImage from "./ProductImage";

test.each([
  ["/assets/scanspace/paint-sage.png", "Sage interior paint"],
  ["/assets/scanspace/floor-light-vinyl.png", "Light oak vinyl flooring"],
])("renders the API-hosted product image %s", (src, name) => {
  render(<ProductImage src={src} alt={name} />);
  expect(screen.getByRole("img", { name }))
    .toHaveAttribute("src", `http://localhost:5000${src}`);
});

test("shows an uploaded file preview without sending it to the API host", () => {
  const preview = "blob:http://localhost:3000/product-preview";
  render(<ProductImage src={preview} alt="Product preview" />);
  expect(screen.getByRole("img", { name: "Product preview" })).toHaveAttribute("src", preview);
});

test("shows the existing catalog icon for products without an image", () => {
  const { container } = render(<ProductImage />);
  expect(container.querySelector("img")).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Product image unavailable" })).toBeInTheDocument();
});

test("replaces a failed image and retries when another product image is selected", () => {
  const { rerender } = render(<ProductImage src="/missing.png" alt="Product preview" />);
  fireEvent.error(screen.getByRole("img", { name: "Product preview" }));
  expect(screen.queryByRole("img", { name: "Product preview" })).not.toBeInTheDocument();
  expect(screen.getByRole("img", { name: "Product image unavailable" })).toBeInTheDocument();

  rerender(<ProductImage src="/assets/scanspace/paint-white.png" alt="Product preview" />);
  expect(screen.getByRole("img", { name: "Product preview" }))
    .toHaveAttribute("src", "http://localhost:5000/assets/scanspace/paint-white.png");
});
