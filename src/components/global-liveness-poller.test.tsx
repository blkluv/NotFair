// @vitest-environment jsdom
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { GlobalLivenessPoller } from "./global-liveness-poller";

beforeEach(() => {
  refresh.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GlobalLivenessPoller", () => {
  it("renders nothing in the DOM", () => {
    const { container } = render(<GlobalLivenessPoller hasInFlight={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("does not start a timer when hasInFlight is false", () => {
    render(<GlobalLivenessPoller hasInFlight={false} />);
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("polls router.refresh() every 2 seconds while hasInFlight is true", () => {
    render(<GlobalLivenessPoller hasInFlight={true} />);
    expect(refresh).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(2);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it("tears the interval down when hasInFlight flips to false", () => {
    const { rerender } = render(<GlobalLivenessPoller hasInFlight={true} />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(<GlobalLivenessPoller hasInFlight={false} />);
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("clears the interval on unmount so no stray refreshes fire", () => {
    const { unmount } = render(<GlobalLivenessPoller hasInFlight={true} />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    unmount();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh interval if hasInFlight flips back to true after being false", () => {
    const { rerender } = render(<GlobalLivenessPoller hasInFlight={false} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(refresh).not.toHaveBeenCalled();
    rerender(<GlobalLivenessPoller hasInFlight={true} />);
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
