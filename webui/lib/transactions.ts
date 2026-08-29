import type { IndexerProvider } from "@tari-project/ootle-indexer";
import type { IndexerGetTransactionResultResponse } from "@tari-project/ootle";
import { sleep } from "./sleep";

export type FinalizedTransactionResult = Extract<
  IndexerGetTransactionResultResponse["result"],
  { Finalized: unknown }
>;

/**
 * Wait for a transaction to reach a terminal state by polling the indexer's
 * `getTransactionResult` until it reports `Finalized` or `Rejected`.
 *
 * We deliberately avoid `watchTransactionSSE`: its SSE path is unreliable (it
 * can hang for its full timeout and report nothing), and the polling fallback it
 * uses has a fixed ~3s grace that is too short for a slow localnet. A plain
 * poll loop is deterministic and gives us full control over the timeout.
 *
 * Resolves only once the transaction is `Finalized`; rejects on `Rejected` or
 * when `timeoutMs` elapses.
 */
export async function waitForTransaction(
  provider: IndexerProvider,
  transactionId: string,
  timeoutMs = 60_000,
): Promise<{ result: FinalizedTransactionResult }> {
  const deadline = Date.now() + timeoutMs;

  while (true) {
    let res: IndexerGetTransactionResultResponse;
    try {
      res = await provider.getTransactionResult(transactionId);
    } catch (err) {
      // The indexer may not have observed the transaction yet and answers 404.
      const message = err instanceof Error ? err.message : String(err);
      if (!/not found|404/i.test(message)) {
        throw err;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Transaction ${transactionId} did not finalise within ${timeoutMs}ms`,
        );
      }
      await sleep(1000);
      continue;
    }

    if (res.result === "Pending") {
      if (Date.now() >= deadline) {
        throw new Error(
          `Transaction ${transactionId} did not finalise within ${timeoutMs}ms`,
        );
      }
      await sleep(1000);
      continue;
    }

    if ("Rejected" in res.result) {
      throw new Error(`transaction rejected: ${res.result.Rejected.details}`);
    }

    if ("Finalized" in res.result) {
      return { result: res.result };
    }

    throw new Error(
      `unexpected transaction result: ${JSON.stringify(res.result)}`,
    );
  }
}
