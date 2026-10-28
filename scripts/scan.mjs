const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const RPC = process.env.SOLANA_RPC_URL;

const PROGRAM = "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m";

if (!TOKEN || !CHAT_ID || !RPC) {
  throw new Error("Telegram secrets atau SOLANA_RPC_URL belum lengkap.");
}

async function rpc(method, params) {
  const maxAttempts = 5;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(RPC, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params
        })
      });

      const raw = await res.text();

      if (!res.ok) {
        throw new Error(
          `RPC HTTP ${res.status}: ${raw.slice(0, 150)}`
        );
      }

      let data;

      try {
        data = JSON.parse(raw);
      } catch {
        throw new Error(
          `RPC mengembalikan respons tidak valid: ${raw.slice(0, 150)}`
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

      const delay = Math.min(
        2000 * 2 ** (attempt - 1),
        30000
      );

      console.log(
        `Permintaan RPC gagal (${attempt}/${maxAttempts}). ` +
        `Mencoba lagi dalam ${delay / 1000} detik.`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error("RPC gagal setelah semua percobaan.");
}

async function sendTelegram(message) {
  const res = await fetch(
    `https://api.telegram.org/bot${TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: message,
        disable_web_page_preview: true
      })
    }
  );

  const data = await res.json();

  if (!res.ok || !data.ok) {
    throw new Error("Telegram gagal mengirim pesan.");
  }
}

console.log("Memulai pemindaian Streamflow...");

const signatures = await rpc("getSignaturesForAddress", [
  PROGRAM,
  {
    limit: 100,
    commitment: "confirmed"
  }
]);

let checked = 0;
let candidates = 0;

for (const item of signatures) {
  if (item.err || !item.blockTime) {
    continue;
  }

  const age = Date.now() / 1000 - item.blockTime;

  if (age > 300 || age < 0) {
    continue;
  }

  const tx = await rpc("getTransaction", [
    item.signature,
    {
      encoding: "jsonParsed",
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0
    }
  ]);

  if (!tx) {
    continue;
  }

  checked++;

  const logs = tx.meta?.logMessages || [];
console.log(
  "DEBUG",
  item.signature,
  logs.filter(line => /Instruction:|Program log:/i.test(line))
);
  const candidate = logs.some(line =>
    /Instruction: (CreateLock|CreateTokenLock)\b/i.test(line)
  );

  if (!candidate) {
    continue;
  }

  candidates++;

  await sendTelegram(
    "🔒 STREAMFLOW LOCK EVENT (CANDIDATE)\n\n" +
    "Transaksi:\n" +
    "https://solscan.io/tx/" + item.signature +
    "\n\n" +
    "Periksa transaksi secara manual untuk memastikan " +
    "bahwa ini Token Lock, bukan Vesting.\n\n" +
    "Jumlah token dan waktu unlock belum dibaca oleh bot."
  );

  await new Promise(resolve => setTimeout(resolve, 1000));
}

console.log("Pemindaian selesai.");
console.log("Transaksi diperiksa: " + checked);
console.log("Kandidat lock ditemukan: " + candidates);
