import fs from "node:fs";
import path from "node:path";

function findPythonExecutable(): string {
  const candidates = [
    process.env.IDX_RADAR_PYTHON,
    path.resolve(process.cwd(), ".pythonlibs/bin/python"),
    path.resolve(process.cwd(), ".venv/bin/python"),
    path.resolve(process.cwd(), "venv/bin/python"),
    "/usr/bin/python3",
    "/usr/local/bin/python3",
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback: gunakan Python dari PATH Replit.
  return "python3";
}
