import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Avoid refetching on every mount/window focus; mutations invalidate
      // explicitly, and long-lived watchers (e.g. wallet status) poll on an
      // interval.
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
