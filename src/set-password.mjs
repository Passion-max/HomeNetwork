// Generate the .env lines for the single household login.
// Usage:  npm run set-password -- '<your password>'
//   (or)  echo '<your password>' | npm run set-password
import { randomBytes } from "node:crypto";
import { hashPassword } from "./auth.mjs";

const fromStdin = () =>
  new Promise((resolve) => {
    let s = "";
    process.stdin.on("data", (d) => (s += d));
    process.stdin.on("end", () => resolve(s.trim()));
  });

const password = process.argv[2] ?? (process.stdin.isTTY ? "" : await fromStdin());
if (!password) {
  console.error("usage: npm run set-password -- '<password>'");
  process.exit(1);
}

console.log("\nAdd these lines to your .env (secret — never commit them):\n");
console.log(`AUTH_USERNAME=admin`);
console.log(`AUTH_PASSWORD_HASH=${hashPassword(password)}`);
if (!process.env.SESSION_SECRET) console.log(`SESSION_SECRET=${randomBytes(32).toString("hex")}`);
console.log("\nChange AUTH_USERNAME to whatever you like, then restart the backend.");
console.log("When you serve over HTTPS (hosted), also add AUTH_SECURE_COOKIE=1\n");
