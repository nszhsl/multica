import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NoAccessPage } from "./no-access-page";

const navigate = vi.fn();
vi.mock("../navigation", () => ({
  useNavigation: () => ({ push: navigate, replace: navigate }),
}));

describe("NoAccessPage", () => {
  beforeEach(() => navigate.mockReset());

  it("renders generic message that doesn't leak existence", () => {
    render(<NoAccessPage />);
    expect(
      screen.getByText(/doesn't exist or you don't have access/i),
    ).toBeInTheDocument();
  });

  it("navigates to root on 'Go to my workspaces'", () => {
    render(<NoAccessPage />);
    fireEvent.click(screen.getByRole("button", { name: /go to my workspaces/i }));
    expect(navigate).toHaveBeenCalledWith("/");
  });

  it("navigates to login on 'Sign in as a different user'", () => {
    render(<NoAccessPage />);
    fireEvent.click(
      screen.getByRole("button", { name: /sign in as a different user/i }),
    );
    expect(navigate).toHaveBeenCalledWith("/login");
  });
});
