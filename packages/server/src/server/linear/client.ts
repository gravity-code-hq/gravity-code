import { z } from "zod";

export const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_MS = 30_000;

export type LinearErrorCode = "auth" | "rate_limited" | "network" | "not_connected" | "request";

export class LinearError extends Error {
  constructor(
    readonly code: LinearErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LinearError";
  }
}

export type LinearFetch = typeof fetch;

const GraphqlErrorSchema = z.object({
  message: z.string(),
  extensions: z
    .object({
      code: z.string().optional(),
      type: z.string().optional(),
      userPresentableMessage: z.string().optional(),
    })
    .optional(),
});

const GraphqlEnvelopeSchema = z.object({
  data: z.unknown().optional(),
  errors: z.array(GraphqlErrorSchema).optional(),
});

function isAuthGraphqlError(error: z.infer<typeof GraphqlErrorSchema>): boolean {
  const code = error.extensions?.code ?? "";
  const type = error.extensions?.type ?? "";
  return (
    code === "AUTHENTICATION_ERROR" ||
    type === "authentication error" ||
    /authentication|not authorized|unauthorized/i.test(error.message)
  );
}

function isRateLimitGraphqlError(error: z.infer<typeof GraphqlErrorSchema>): boolean {
  const code = error.extensions?.code ?? "";
  return code === "RATELIMITED" || /rate ?limit/i.test(error.message);
}

/**
 * Minimal Linear GraphQL transport: one request, one typed parse. Linear's API
 * key goes in `Authorization` as-is (no `Bearer` prefix).
 */
export class LinearGraphqlClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: LinearFetch = fetch,
  ) {}

  async query<T>(
    document: string,
    variables: Record<string, unknown>,
    resultSchema: z.ZodType<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timeout.unref?.();
    let response: Response;
    try {
      response = await this.fetchImpl(LINEAR_GRAPHQL_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: this.apiKey,
        },
        body: JSON.stringify({ query: document, variables }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = controller.signal.aborted
        ? "Linear request timed out"
        : "Could not reach Linear";
      throw new LinearError("network", message, { cause: error });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw new LinearError("auth", "Linear rejected the API key");
    }
    if (response.status === 429) {
      throw new LinearError("rate_limited", "Linear rate limit reached; try again shortly");
    }

    let envelope: z.infer<typeof GraphqlEnvelopeSchema>;
    try {
      envelope = GraphqlEnvelopeSchema.parse(await response.json());
    } catch (error) {
      throw new LinearError(
        "request",
        `Linear returned an unreadable response (${response.status})`,
        {
          cause: error,
        },
      );
    }

    const errors = envelope.errors ?? [];
    if (errors.length > 0) {
      const first = errors[0]!;
      if (errors.some(isAuthGraphqlError)) {
        throw new LinearError("auth", "Linear rejected the API key");
      }
      if (errors.some(isRateLimitGraphqlError)) {
        throw new LinearError("rate_limited", "Linear rate limit reached; try again shortly");
      }
      throw new LinearError("request", first.extensions?.userPresentableMessage ?? first.message);
    }
    if (!response.ok) {
      throw new LinearError("request", `Linear request failed (${response.status})`);
    }

    return resultSchema.parse(envelope.data);
  }
}
