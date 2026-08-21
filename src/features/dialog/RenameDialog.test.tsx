import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RenameDialog } from "./RenameDialog";

describe("ブランチ名の変更", () => {
  it("いまの名前が入った状態で開く", () => {
    render(<RenameDialog name="feature/rec-482" onRename={vi.fn()} onCancel={vi.fn()} />);

    const input = screen.getByLabelText("ブランチ名:");
    expect(input).toHaveProperty("value", "feature/rec-482");
  });

  it("名前を変えていなければ確定できない", () => {
    render(<RenameDialog name="main" onRename={vi.fn()} onCancel={vi.fn()} />);

    expect(screen.getByText("名前の変更")).toHaveProperty("disabled", true);
  });

  it("空にしても確定できない", () => {
    render(<RenameDialog name="main" onRename={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("ブランチ名:"), { target: { value: "  " } });

    expect(screen.getByText("名前の変更")).toHaveProperty("disabled", true);
  });

  it("前後の空白を落として渡す", () => {
    const onRename = vi.fn();
    render(<RenameDialog name="main" onRename={onRename} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("ブランチ名:"), { target: { value: "  trunk " } });
    fireEvent.click(screen.getByText("名前の変更"));

    expect(onRename).toHaveBeenCalledExactlyOnceWith("trunk");
  });
});
