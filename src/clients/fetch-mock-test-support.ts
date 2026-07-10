export type FetchHandler = (input: URL | Request | string) => Promise<Response> | Response;

export async function withMockFetch(
  handler: FetchHandler,
  run: () => Promise<void> | void,
): Promise<void> {
  const originalFetch = global.fetch;
  global.fetch = (async (input: URL | Request | string) => handler(input)) as typeof fetch;
  try {
    await run();
  } finally {
    global.fetch = originalFetch;
  }
}

export function routeHandler(
  routes: ReadonlyMap<string, Response | (() => Response)>,
): FetchHandler {
  return (input) => {
    const url = typeof input === "string" ? input : input.toString();
    const route = routes.get(url);
    if (!route) {
      throw new Error(`Unexpected route: ${url}`);
    }

    return typeof route === "function" ? route() : route;
  };
}
