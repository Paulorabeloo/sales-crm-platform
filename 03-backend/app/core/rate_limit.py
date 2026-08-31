"""Minimal in-memory sliding-window rate limiter.

Good enough for a single-process deployment (this app's scale). If the API is
ever scaled horizontally, swap for a Redis-backed limiter behind the same
interface.
"""

import time
from collections import defaultdict, deque
from threading import Lock


class SlidingWindowRateLimiter:
    """Allow at most ``limit`` hits per ``window_seconds`` per key."""

    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = time.monotonic()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            return True

    def reset(self) -> None:
        """Clear all buckets (used by tests)."""
        with self._lock:
            self._hits.clear()


# Shared instances (process-wide)
login_limiter = SlidingWindowRateLimiter(limit=5, window_seconds=60)
webhook_ip_limiter = SlidingWindowRateLimiter(limit=60, window_seconds=60)
webhook_token_limiter = SlidingWindowRateLimiter(limit=120, window_seconds=60)
