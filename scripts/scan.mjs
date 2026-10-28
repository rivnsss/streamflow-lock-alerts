const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC = process.env.SOLANA_RPC_URL ||
  "https://api.mainnet-beta.solana.com";

const PROGRAM = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";

if (!TOKEN || !CHAT_ID) {
  throw new Error("Telegram secrets belum lengkap.");
}

async function rpc(method, params) {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params
        })
      });

      const raw = await res.text();

      if (res.status === 429 || res.status >= 500) {
        throw new Error(`HTTP ${res.status}: ${raw.slice(0, 150)}`);
      }

      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status}: ${raw.slice(0, 150)}`);
      }

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `RPC returned invalid JSON: ${raw.slice(0, 150)}`
        );
      }

      if (data.error) {
        throw new Error(
          `RPC error: ${JSON.stringify(data.error)}`
        );
      }

      return data.result;

    } catch (error) {
      if (attempt === maxAttempts) {
        throw error;
      }

      const delay = Math.min(1000 * 2 ** (attempt - 1), 16000);

      console.log(
        `RPC request failed (attempt ${attempt}/${maxAttempts}). ` +
        `Retrying in ${delay / 1000}s...`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
                                                             }

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error("Solana RPC request failed");
  }
  return data.result;
}

async function sendTelegram(text) {
  const res = await fetch(
    `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        disable_web_page_preview: true
      })
    }
  );

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error("Telegram send failed");
  }
}

const signatures = await rpc("getSignaturesForAddress", [
  PROGRAM,
  { limit: 100, commitment: "confirmed" }
]);

let checked = 0;

for (const item of signatures) {
  if (item.err || !item.blockTime) continue;

  // Only inspect recent transactions.
  if (Date.now() / 1000 - item.blockTime > 300) continue;

  const tx = await rpc("getTransaction", [
    item.signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    }
  ]);

  if (!tx) continue;
  checked++;

  const logs = tx.meta?.logMessages || [];

  // Candidate creation events only; must be validated against
  // actual Streamflow lock transactions before relying on alerts.
  const candidate = logs.some(line =>
    /Instruction: (CreateLock|CreateTokenLock)\b/i.test(line)
  );

  if (!candidate) continue;

  await sendTelegram(
    "🔒 STREAMFLOW LOCK EVENT (candidate)\n\n" +
    "Transaction:\nhttps://solscan.io/tx/" + item.signature +
    "\n\nVerify the transaction manually. Token amount, unlock date, " +
    "and USD value are not decoded yet."
  );
}

console.log("Scan selesai. Transaksi diperiksa: " + checked);
