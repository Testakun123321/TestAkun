import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetDiagnosticsResponse,
  GetScannerResponse,
  GetStockDetailParams,
  GetStockDetailResponse,
  GetSymbolsResponse,
  TestDataConnectionResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();
const supportedSymbols = new Set([
  "BBCA",
  "BBRI",
  "BMRI",
  "BBNI",
  "TLKM",
  "ASII",
  "ANTM",
  "ADRO",
  "ICBP",
  "INDF",
  "UNTR",
  "PGAS",
  "BRIS",
  "GOTO",
  "PTBA",
  "MDKA",
]);

type WorkerAction = "symbols" | "scanner" | "stock" | "diagnostics";

function findWorkspaceRoot(): string {
  const roots = [
    process.cwd(),
    resolve(process.cwd(), "../.."),
    resolve(process.cwd(), "../../.."),
  ];
  const root = roots.find((candidate) =>
    existsSync(resolve(candidate, "artifacts/api-server/src/market_data.py")),
  );
  if (!root) {
    throw new Error(
      "IDX Radar Python worker was not found at artifacts/api-server/src/market_data.py.",
    );
  }
  return root;
}

function runMarketWorker(action: WorkerAction, input: Record<string, unknown> = {}): Promise<unknown> {
  const root = findWorkspaceRoot();
  const scriptPath = resolve(root, "artifacts/api-server/src/market_data.py");
  const pythonPath =
    process.env.IDX_RADAR_PYTHON ?? resolve(root, ".pythonlibs/bin/python");
  if (!existsSync(pythonPath)) {
    throw new Error(
      `Python environment not found at ${pythonPath}. Install the dependencies from pyproject.toml and uv.lock.`,
    );
  }

  return new Promise((resolveResult, reject) => {
    const child = spawn(pythonPath, [scriptPath, action], {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python worker exited with status ${code}.`));
        return;
      }
      try {
        resolveResult(JSON.parse(stdout));
      } catch (error) {
        reject(
          new Error(
            `Python worker returned invalid JSON: ${error instanceof Error ? error.message : String(error)}. ${stderr.trim()}`,
          ),
        );
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function sendWorkerError(
  req: Request,
  res: Response,
  error: unknown,
  message: string,
): void {
  req.log.error({ err: error }, message);
  res.status(503).json({
    error: error instanceof Error ? error.message : String(error),
  });
}

router.get("/scanner", async (req, res): Promise<void> => {
  try {
    const data = await runMarketWorker("scanner");
    res.json(GetScannerResponse.parse(data));
  } catch (error) {
    sendWorkerError(req, res, error, "IDX Radar scanner data request failed");
  }
});

router.get("/symbols", async (req, res): Promise<void> => {
  try {
    const data = await runMarketWorker("symbols");
    res.json(GetSymbolsResponse.parse(data));
  } catch (error) {
    sendWorkerError(req, res, error, "IDX Radar symbol list request failed");
  }
});

router.get("/stocks/:symbol", async (req, res): Promise<void> => {
  const params = GetStockDetailParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const symbol = params.data.symbol.toUpperCase();
  if (!supportedSymbols.has(symbol)) {
    res.status(400).json({ error: `Simbol ${symbol} belum termasuk dalam cakupan IDX Radar.` });
    return;
  }
  try {
    const data = await runMarketWorker("stock", { symbol });
    res.json(GetStockDetailResponse.parse(data));
  } catch (error) {
    sendWorkerError(req, res, error, "IDX Radar stock detail request failed");
  }
});

async function sendDiagnostics(
  req: Request,
  res: Response,
  schema: typeof GetDiagnosticsResponse | typeof TestDataConnectionResponse,
): Promise<void> {
  try {
    const data = await runMarketWorker("diagnostics");
    res.json(schema.parse(data));
  } catch (error) {
    sendWorkerError(req, res, error, "IDX Radar Yahoo Finance connectivity test failed");
  }
}

router.get("/diagnostics", async (req, res): Promise<void> => {
  await sendDiagnostics(req, res, GetDiagnosticsResponse);
});

router.post("/diagnostics/connection-test", async (req, res): Promise<void> => {
  await sendDiagnostics(req, res, TestDataConnectionResponse);
});

export default router;