// Builds the frontend as a static site (web/out) for single-process serving.
// Works on Windows and Linux/Termux without extra deps.
import { execSync } from "node:child_process";

process.env.BUILD_EXPORT = "1";
execSync("next build", { stdio: "inherit", env: process.env });
