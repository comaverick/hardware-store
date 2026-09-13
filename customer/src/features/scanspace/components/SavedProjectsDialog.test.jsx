import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SavedProjectsDialog from "./SavedProjectsDialog";

function response(data, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
  });
}

beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(values) {
        values.fill(7);
        return values;
      },
    },
  });
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.restoreAllMocks();
});

test("lists saved rooms, creates a transfer code, and claims a phone room", async () => {
  const phoneRoom = {
    _id: "1".repeat(24),
    name: "Phone scan",
    updatedAt: "2026-09-13T01:00:00.000Z",
  };
  const copiedRoom = {
    _id: "2".repeat(24),
    revision: 1,
    room: { name: "Phone scan" },
  };
  fetch
    .mockImplementationOnce(() => response([phoneRoom]))
    .mockImplementationOnce(() =>
      response({
        code: "ABCD-EFGH-JKLM",
        expiresAt: "2026-09-13T02:00:00.000Z",
      }),
    )
    .mockImplementationOnce(() => response(copiedRoom, 201));
  const onLoad = jest.fn();

  render(
    <SavedProjectsDialog onClose={() => {}} onLoad={onLoad} />,
  );

  expect(await screen.findByText("Phone scan")).toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "Send Phone scan to another device",
    }),
  );
  expect(await screen.findByText("ABCD-EFGH-JKLM")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("Transfer code"), {
    target: { value: "abcd efgh jklm" },
  });
  fireEvent.click(screen.getByRole("button", { name: /open room/i }));

  await waitFor(() => expect(onLoad).toHaveBeenCalledWith(copiedRoom));
  expect(fetch.mock.calls[2][0]).toContain("/api/scanspace/transfers/claim");
  expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({
    code: "ABCDEFGHJKLM",
  });
});
