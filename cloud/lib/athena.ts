import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionStatus,
} from "@aws-sdk/client-athena";
import { config } from "./config";

let athenaClient: AthenaClient | null = null;

function getAthenaClient(): AthenaClient {
  if (!athenaClient) {
    athenaClient = new AthenaClient({ region: config.aws.region });
  }
  return athenaClient;
}

export async function runQuery(sql: string): Promise<Record<string, unknown>[]> {
  const client = getAthenaClient();

  // Start query execution
  const startResult = await client.send(
    new StartQueryExecutionCommand({
      QueryString: sql,
      QueryExecutionContext: {
        Database: config.aws.athenaDb,
      },
      ResultConfiguration: {
        OutputLocation: config.aws.athenaOutput,
      },
    })
  );

  const queryExecutionId = startResult.QueryExecutionId;
  if (!queryExecutionId) throw new Error("Failed to start query execution");

  // Poll for completion (30s timeout, 500ms interval)
  let status: string | undefined;
  const startTime = Date.now();
  const timeout = 30000; // 30 seconds

  while (Date.now() - startTime < timeout) {
    const execResult = await client.send(
      new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId,
      })
    );

    status = execResult.QueryExecution?.Status?.State;
    if (status === "SUCCEEDED") break;
    if (status === "FAILED" || status === "CANCELLED") {
      throw new Error(
        `Query failed: ${execResult.QueryExecution?.Status?.StateChangeReason}`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  if (status !== "SUCCEEDED") {
    throw new Error("Query execution timeout or not completed");
  }

  // Get results
  const resultsResponse = await client.send(
    new GetQueryResultsCommand({
      QueryExecutionId: queryExecutionId,
    })
  );

  const resultRows = resultsResponse.ResultSet?.Rows || [];
  if (resultRows.length < 1) return [];

  // First row is header
  const headers = resultRows[0].Data?.map((cell) => cell.VarCharValue || "") || [];

  // Convert remaining rows to objects
  const results: Record<string, unknown>[] = [];
  for (let i = 1; i < resultRows.length; i++) {
    const row = resultRows[i];
    const obj: Record<string, unknown> = {};
    const cellValues = row.Data || [];

    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      const value = cellValues[j]?.VarCharValue;
      // Try to parse as number if it looks numeric
      if (value && !isNaN(Number(value)) && value !== "") {
        obj[header] = Number(value);
      } else {
        obj[header] = value || null;
      }
    }

    results.push(obj);
  }

  return results;
}
