const TELEGRAM_CHAT_ID = "55014832";



const ALLOWED_ORIGINS = [

  "https://behnamhuntingroom.github.io",

  "https://behnamhunter.ir",

  "https://www.behnamhunter.ir"

];



const TTL_SECONDS = 7 * 24 * 60 * 60;

const AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;



const ALLOWED_MIME = {

  "application/pdf": [".pdf"],

  "image/jpeg": [".jpg", ".jpeg"],

  "image/png": [".png"],

  "text/plain": [".txt"],

  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"]

};



function timingLog(stage, details = {}) {

  console.log("[BHR_TIMING]", JSON.stringify({

    stage,

    time: new Date().toISOString(),

    epoch: Date.now(),

    ...details

  }));

}



function corsHeaders(origin) {

  return {

    "Access-Control-Allow-Origin": origin,

    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",

    "Access-Control-Allow-Headers": "Content-Type",

    "Access-Control-Expose-Headers": "Content-Disposition",

    "Vary": "Origin"

  };

}



function json(data, status, headers = {}) {

  return new Response(JSON.stringify(data), {

    status,

    headers: {

      "Content-Type": "application/json; charset=utf-8",

      "Cache-Control": "no-store",

      ...headers

    }

  });

}



function safeFilename(name) {

  return String(name || "attachment")

    .replace(/[\\/\\\\:\*?"<>|\r\n]/g, "\_")

    .slice(0, 120);

}



function decodeDataUrl(dataUrl) {

  if (typeof dataUrl !== "string" || dataUrl.length > 12 * 1024 * 1024) {

    throw new Error("Invalid or oversized attachment data");

  }



  const match = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl);

  if (!match) throw new Error("Invalid data URL");



  const mime = match[1].toLowerCase();

  const binary = atob(match[2]);



  if (binary.length > MAX_ATTACHMENT_BYTES) {

    throw new Error("Attachment exceeds 8 MB");

  }



  const bytes = new Uint8Array(binary.length);



  for (let i = 0; i < binary.length; i++) {

    bytes[i] = binary.charCodeAt(i);

  }



  return { mime, bytes };

}



function validateAttachmentName(name, mime) {

  const safeName = safeFilename(name);

  const lowerName = safeName.toLowerCase();



  const allowedExtensions = ALLOWED_MIME[mime];



  if (!allowedExtensions ||

      !allowedExtensions.some(ext => lowerName.endsWith(ext))) {

    throw new Error("Unsupported file type");

  }



  return safeName;

}



async function telegramSend(env, text, forceReply = false) {

  const response = await fetch(

    `https\://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,

    {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({

        chat_id: TELEGRAM_CHAT_ID,

        text,

        ...(forceReply ? {

          reply_markup: {

            force_reply: true,

            selective: true

          }

        } : {})

      })

    }

  );



  return await response.json();

}



async function telegramSendDocument(env, caption, attachment) {

  const { mime, bytes } = decodeDataUrl(attachment.data);

  const filename = validateAttachmentName(attachment.name, mime);



  const form = new FormData();



  form.append("chat_id", TELEGRAM_CHAT_ID);

  form.append("caption", caption.slice(0, 1024));



  form.append("reply_markup", JSON.stringify({

    force_reply: true,

    selective: true

  }));



  form.append(

    "document",

    new Blob([bytes], { type: mime }),

    filename

  );



  const response = await fetch(

    `https\://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`,

    {

      method: "POST",

      body: form

    }

  );



  return await response.json();

}



async function checkAIRateLimit(request, env) {

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";



  const digest = await crypto.subtle.digest(

    "SHA-256",

    new TextEncoder().encode(ip)

  );



  const hash = Array.from(new Uint8Array(digest))

    .map(b => b.toString(16).padStart(2, "0"))

    .join("");



  const minute = Math.floor(Date.now() / 60000);

  const day = new Date().toISOString().slice(0, 10);



  const minuteKey = `ai:minute:${hash}:${minute}`;

  const dayKey = `ai:day:${hash}:${day}`;



  const minuteCount = Number(await env.CHAT_STORE.get(minuteKey) || 0);

  const dayCount = Number(await env.CHAT_STORE.get(dayKey) || 0);



  if (minuteCount >= 8 || dayCount >= 80) return false;



  await Promise.all([

    env.CHAT_STORE.put(minuteKey, String(minuteCount + 1), {

      expirationTtl: 120

    }),

    env.CHAT_STORE.put(dayKey, String(dayCount + 1), {

      expirationTtl: 86400

    })

  ]);



  return true;

}



async function handleAI(request, env, headers) {

  if (!env.AI || !env.CHAT_STORE) {

    return json({

      ok: false,

      error: "AI service is not configured"

    }, 503, headers);

  }



  try {

    const allowed = await checkAIRateLimit(request, env);



    if (!allowed) {

      return json({

        ok: false,

        error: "محدودیت تعداد درخواست؛ کمی بعد دوباره تلاش کن."

      }, 429, headers);

    }



    const data = await request.json();



    const message = String(data.message || "").trim();

    const newsContext = String(data.newsContext || "").slice(0, 5000);

    const calendarContext = String(data.calendarContext || "").slice(0, 3000);

    const imageData = data.image ? String(data.image) : "";



    if ((!message && !imageData) || message.length > 3000) {

      return json({

        ok: false,

        error: "Invalid message"

      }, 400, headers);

    }



    if (imageData) {

      const { mime, bytes } = decodeDataUrl(imageData);



      if (!["image/jpeg", "image/png"].includes(mime)) {

        return json({

          ok: false,

          error: "دستیار فقط تصویر JPG یا PNG را برای تحلیل می‌پذیرد."

        }, 400, headers);

      }



      if (bytes.length > MAX_ATTACHMENT_BYTES) {

        return json({

          ok: false,

          error: "حجم تصویر نباید بیشتر از ۸ مگابایت باشد."

        }, 413, headers);

      }

    }



    const systemPrompt = `

تو دستیار هوشمند اختصاصی BEHNAM HUNTING ROOM هستی.



قوانین:

\- همیشه فارسی روان و حرفه‌ای پاسخ بده.

\- پاسخ‌ها دقیق و کاربردی و بدون حاشیه باشند.

\- قیمت زنده بازار را حدس نزن.

\- اگر داده کافی نداری، صریح بگو.

\- سود قطعی یا سیگنال تضمینی وعده نده.

\- تحلیل را همراه با سناریوی جایگزین و مدیریت ریسک ارائه کن.



روش P1/P2/P3:

P1 نقطه چرخش مهم و آغاز روند جدید است.

P2 سقف یا کف بعدی در جهت روند جدید است.

P3 اصلاح قیمت پس از شکل‌گیری P2 است.

در روند صعودی، شکست بدنه کندل بالای سقف P2 تأیید روند است.

در روند نزولی، شکست بدنه کندل زیر کف P2 تأیید روند است.

عبور سایه کندل از P2 به‌تنهایی تأیید محسوب نمی‌شود.



اگر تصویر دریافت کردی، فقط موارد واقعاً قابل مشاهده را تحلیل کن.

اگر اعداد یا نوشته‌ها خوانا نیستند، حدس نزن.

`;



    const userPrompt = `

اخبار سایت:

${newsContext || "خبر قابل‌خواندنی در اختیار نیست."}



تقویم اقتصادی:

${calendarContext || "اطلاعات تقویم اقتصادی در اختیار نیست."}



سؤال کاربر:

${message || "لطفاً تصویر پیوست‌شده را بررسی کن."}

`;



    const model = imageData ? VISION_MODEL : AI_MODEL;



    const modelInput = {

      messages: [

        { role: "system", content: systemPrompt },

        { role: "user", content: userPrompt }

      ],

      max_tokens: 850,

      temperature: 0.25

    };



    if (imageData) modelInput.image = imageData;



    const result = await env.AI.run(model, modelInput);

    const answer = String(result?.response || "").trim();



    if (!answer) {

      return json({

        ok: false,

        error: "AI returned an empty response"

      }, 502, headers);

    }



    return json({

      ok: true,

      answer,

      model,

      timestamp: Date.now()

    }, 200, headers);



  } catch (error) {

    console.error("[BHR_AI_ERROR]", error?.message || "Unknown error");



    const detail = String(error?.message || "");



    const userError = /license|accept|policy/i.test(detail)

      ? "برای تحلیل تصویر، مجوز مدل بینایی Cloudflare باید فعال شود."

      : "سرویس هوش مصنوعی موقتاً در دسترس نیست.";



    return json({

      ok: false,

      error: userError

    }, 500, headers);

  }

}



/* دریافت فایل از تلگرام و ذخیره آن در KV */

async function receiveTelegramAttachment(message, env) {

  let fileId = "";

  let filename = "";

  let mime = "";

  let expectedSize = 0;



  if (message.document) {

    fileId = message.document.file_id;

    filename = safeFilename(message.document.file_name || "telegram-file");

    mime = String(message.document.mime_type || "").toLowerCase();

    expectedSize = Number(message.document.file_size || 0);



  } else if (Array.isArray(message.photo) && message.photo.length) {

    const photo = message.photo[message.photo.length - 1];



    fileId = photo.file_id;

    filename = `telegram-photo-${message.message_id}.jpg`;

    mime = "image/jpeg";

    expectedSize = Number(photo.file_size || 0);



  } else {

    return null;

  }



  if (!fileId) throw new Error("Telegram file ID missing");



  if (!ALLOWED_MIME[mime]) {

    const extension = filename.toLowerCase().split(".").pop();



    const mimeByExtension = {

      pdf: "application/pdf",

      jpg: "image/jpeg",

      jpeg: "image/jpeg",

      png: "image/png",

      txt: "text/plain",

      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

    };



    mime = mimeByExtension[extension] || "";

  }



  if (!mime || !ALLOWED_MIME[mime]) {

    throw new Error("Unsupported Telegram file type");

  }



  filename = validateAttachmentName(filename, mime);



  if (expectedSize > MAX_ATTACHMENT_BYTES) {

    throw new Error("Telegram attachment exceeds 8 MB");

  }



  const getFileResponse = await fetch(

    `https\://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`

  );



  const getFileData = await getFileResponse.json();



  if (!getFileData.ok || !getFileData.result?.file_path) {

    throw new Error("Telegram getFile failed");

  }



  const downloadResponse = await fetch(

    `https\://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${getFileData.result.file_path}`

  );



  if (!downloadResponse.ok) {

    throw new Error("Telegram file download failed");

  }



  const bytes = await downloadResponse.arrayBuffer();



  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {

    throw new Error("Downloaded file exceeds 8 MB");

  }



  const storedFileId = crypto.randomUUID();



  await env.CHAT_STORE.put(

    `att:${storedFileId}`,

    bytes,

    { expirationTtl: TTL_SECONDS }

  );



  return {

    fileId: storedFileId,

    name: filename,

    mime,

    size: bytes.byteLength

  };

}



/* Telegram webhook */

async function handleTelegramWebhook(request, env) {

  const requestStartedAt = Date.now();

  const webhookReceivedAt = Date.now();



  timingLog("webhook_received");



  if (request.method !== "POST") {

    return new Response("Method not allowed", { status: 405 });

  }



  const secret = request.headers.get(

    "X-Telegram-Bot-Api-Secret-Token"

  );



  if (!secret || secret !== env.TELEGRAM_WEBHOOK_SECRET) {

    return new Response("Unauthorized", { status: 401 });

  }



  try {

    const update = await request.json();

    const message = update.message;



    if (!message) {

      return json({ ok: true });

    }



    if (String(message.chat?.id) !== TELEGRAM_CHAT_ID) {

      return json({ ok: true });

    }



    if (!message.reply_to_message) {

      timingLog("webhook_not_a_reply", {

        updateId: update.update_id

      });



      return json({ ok: true });

    }



    const repliedMessageId = message.reply_to_message.message_id;



    const conversationId = await env.CHAT_STORE.get(

      `tgmsg:${repliedMessageId}`

    );



    if (!conversationId) {

      timingLog("webhook_conversation_not_found", {

        updateId: update.update_id,

        repliedMessageId

      });



      return json({ ok: true, ignored: true });

    }



    let attachment = null;



    const hasDocument = Boolean(message.document);

    const hasPhoto = Array.isArray(message.photo) && message.photo.length > 0;



    if (hasDocument || hasPhoto) {

      try {

        attachment = await receiveTelegramAttachment(message, env);

      } catch (fileError) {

        console.error("[BHR_TELEGRAM_FILE_ERROR]", fileError?.message || "Unknown error");



        await telegramSend(

          env,

          "فایل دریافت شد اما قابل ذخیره نبود. فرمت مجاز: PDF، JPG، PNG، TXT و DOCX. حداکثر حجم: ۸ مگابایت."

        );



        return json({

          ok: true,

          attachmentError: true

        });

      }

    }



    const replyText = String(message.text || message.caption || "").trim();



    if (!replyText && !attachment) {

      return json({ ok: true });

    }



    const storageKey = `conv:${conversationId}`;



    const oldMessages = await env.CHAT_STORE.get(

      storageKey,

      "json"

    ) || [];



    const storedAt = Date.now();



    const entry = {

      id: String(message.message_id),

      text: replyText || (attachment ? "فایل پیوست‌شده از طرف پشتیبانی" : ""),

      from: "support",

      timestamp: storedAt,

      webhookReceivedAt

    };



    if (attachment) {

      entry.attachment = attachment;



      await env.CHAT_STORE.put(

        `attmeta:${attachment.fileId}`,

        JSON.stringify({
          conversationId,
          name: attachment.name,
          mime: attachment.mime,
          size: attachment.size
        }),

        { expirationTtl: TTL_SECONDS }

      );

    }



    oldMessages.push(entry);



    await env.CHAT_STORE.put(

      storageKey,

      JSON.stringify(oldMessages),

      { expirationTtl: TTL_SECONDS }

    );



    timingLog("webhook_message_stored", {

      updateId: update.update_id,

      telegramMessageId: message.message_id,

      hasAttachment: Boolean(attachment),

      totalWorkerDurationMs: Date.now() - requestStartedAt

    });



    return json({

      ok: true,

      receivedAt: webhookReceivedAt,

      storedAt

    });



  } catch (error) {

    console.error("[BHR_WEBHOOK_ERROR]", error?.message || "Unknown error");



    return json({

      ok: false

    }, 500);

  }

}

/* BHR Opportunity Scanner: public/free feeds, observation only (no fabricated trade levels). */
async function handleOpportunityScanner(env, headers) {
  const cacheKey = "bhr:opportunity-scanner:v5";
  try {
    const cached = env.CHAT_STORE ? await env.CHAT_STORE.get(cacheKey, "json") : null;
    if (cached && cached.updatedAt && Date.now() - Date.parse(cached.updatedAt) < 60 * 1000) {
      return json({ ...cached, cached: true }, 200, { ...headers, "Cache-Control": "public, max-age=20" });
    }
  } catch (e) { console.error("[BHR_SCANNER_CACHE_READ]", e?.message || "cache unavailable"); }

  const observedAt = new Date().toISOString();
  const markets = {
    iran: { ok: false, source: "TSETMC", delay: "زمان انتشار وابسته به بازار ایران", items: [], note: "داده لحظه‌ای/تاریخی هر نماد در این خروجی تضمین نمی‌شود." },
    us: { ok: false, source: "Yahoo Finance public screener", delay: "ممکن است با تأخیر باشد", items: [], note: "سهام پرتراکنش و نمادهای دارای تغییر روزانه برجسته؛ نه تمام نمادهای بورس آمریکا." },
    forex: { ok: false, source: "Yahoo Finance public chart", delay: "ممکن است با تأخیر باشد", items: [], note: "جفت‌ارزهای اصلی و طلای جهانی؛ داده رایگان بدون تضمین SLA." },
    crypto: { ok: false, source: "CoinLore public market data", delay: "قیمت و تغییرات ۲۴ ساعته؛ ممکن است با تأخیر باشد", items: [], note: "رمزارزهای پرتراکنش بر پایه حجم دلاری بازار؛ منبع جایگزین عمومی به‌جای Binance." }
  };
  const headersUp = { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; BHRScanner/1.0; +https://behnamhunter.ir)" };
  const safeFetchJson = async (url, extra = {}) => {
    const response = await fetch(url, { headers: { ...headersUp, ...extra }, cf: { cacheTtl: 20, cacheEverything: true } });
    if (!response.ok) throw new Error("HTTP " + response.status);
    return response.json();
  };
  const score = (pct, volumeRatio = 1) => Math.max(0, Math.min(100, Math.round(Math.abs(Number(pct) || 0) * 5 + Math.max(0, Math.min(4, volumeRatio - 1)) * 12)));
  const direction = pct => Number(pct) > 0 ? "صعودی" : Number(pct) < 0 ? "نزولی" : "خنثی";

  const jobs = [
    (async () => {
      try {
        const tsetmcHeaders = { "Referer": "https://www.tsetmc.com/" };
        let rows = [];
        let mapError = "";
        try {
          const data = await safeFetchJson("https://cdn.tsetmc.com/api/ClosingPrice/GetMarketMap?market=0&size=1920&sector=0&typeSelected=1&hEven=0", tsetmcHeaders);
          rows = Array.isArray(data) ? data : (Array.isArray(data?.marketMap) ? data.marketMap : (Array.isArray(data?.marketmap) ? data.marketmap : []));
        } catch (e) { mapError = String(e?.message || e); }
        if (!rows.length) {
          const watchUrl = "https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&paperTypes%5B0%5D=1&paperTypes%5B1%5D=2&paperTypes%5B2%5D=3&paperTypes%5B3%5D=4&paperTypes%5B4%5D=5&paperTypes%5B5%5D=6&paperTypes%5B6%5D=7&paperTypes%5B7%5D=8&paperTypes%5B8%5D=9&showTraded=false&withBestLimits=false&hEven=0&RefID=0";
          const watchData = await safeFetchJson(watchUrl, tsetmcHeaders);
          rows = Array.isArray(watchData) ? watchData : (Array.isArray(watchData?.marketwatch) ? watchData.marketwatch : (Array.isArray(watchData?.marketWatch) ? watchData.marketWatch : []));
          if (!rows.length && mapError) throw new Error("GetMarketMap: " + mapError + "; GetMarketWatch returned no symbols");
        }
        markets.iran.items = rows.map(x => {
            const symbol = String(x?.lva || x?.lVal18AFC || x?.symbol || "").trim();
            const name = String(x?.lvc || x?.lVal30 || x?.lSecVal || x?.name || "").trim();
            const price = Number(x?.pmd || x?.pDrCotVal || x?.pcl || x?.pClosing || x?.pf || 0);
            const close = Number(x?.pcl || x?.pClosing || x?.pDrCotVal || 0);
            const previous = Number(x?.py || x?.pYesterday || 0);
            const explicitPct = x?.percent ?? x?.priceChangePercent ?? x?.regularMarketChangePercent;
            const pct = explicitPct !== undefined && explicitPct !== null && Number.isFinite(Number(explicitPct))
              ? Number(explicitPct)
              : (previous > 0 && close > 0 ? ((close - previous) / previous) * 100 : 0);
            const volume = Number(x?.qTotTran5J || x?.qtj || 0);
            const trades = Number(x?.zTotTran || x?.ztt || 0);
            const value = Number(x?.qTotCap || x?.qtc || 0);
            if (!symbol || !Number.isFinite(price) || price <= 0) return null;
            return { symbol, name: name || symbol, price, changePct: pct, volume, trades, value, direction: direction(pct), score: score(pct), observedAt, dataTime: null, reason: "تغییر قیمت روزانه در نقشه بازار؛ برای تصمیم‌گیری نمودار و حجم را بررسی کن", kind: "رصد روزانه", actionable: false };
          }).filter(Boolean).sort((a,b) => b.score-a.score).slice(0, 80);
        markets.iran.ok = markets.iran.items.length > 0;
        if (!markets.iran.ok) markets.iran.error = "پاسخ TSETMC دریافت شد، اما نماد معتبر در آن پیدا نشد";
      } catch (e) { markets.iran.error = String(e?.message || "منبع TSETMC در دسترس نیست"); }
    })(),
    (async () => {
      try {
        const urls = ["most_actives", "day_gainers"].map(id => "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=false&scrIds=" + id + "&count=40&start=0");
        const results = await Promise.all(urls.map(u => safeFetchJson(u)));
        const bySymbol = new Map();
        for (const result of results) {
          const quotes = result?.finance?.result?.[0]?.quotes || [];
          for (const q of quotes) if (q?.symbol && Number.isFinite(Number(q.regularMarketPrice))) bySymbol.set(q.symbol, q);
        }
        markets.us.items = [...bySymbol.values()].map(q => {
          const pct = Number(q.regularMarketChangePercent || 0);
          const vol = Number(q.regularMarketVolume || 0), avg = Number(q.averageDailyVolume3Month || 0);
          const ratio = avg > 0 ? vol / avg : 1;
          const t = Number(q.regularMarketTime || 0);
          return { symbol: q.symbol, name: q.shortName || q.longName || q.symbol, price: Number(q.regularMarketPrice), changePct: pct, volume: vol, direction: direction(pct), score: score(pct, ratio), observedAt, dataTime: t ? new Date(t*1000).toISOString() : null, reason: "تغییر روزانه و رتبه فعالیت/حجم در غربالگر عمومی", kind: "رصد بازار", actionable: false };
        }).sort((a,b)=>b.score-a.score).slice(0, 50);
        markets.us.ok = markets.us.items.length > 0;
      } catch (e) { markets.us.error = String(e?.message || "غربالگر Yahoo Finance در دسترس نیست"); }
    })(),
    (async () => {
      const symbols = ["EURUSD=X","GBPUSD=X","USDJPY=X","USDCHF=X","AUDUSD=X","USDCAD=X","NZDUSD=X","GC=F"];
      const labels = { "EURUSD=X":"EUR/USD", "GBPUSD=X":"GBP/USD", "USDJPY=X":"USD/JPY", "USDCHF=X":"USD/CHF", "AUDUSD=X":"AUD/USD", "USDCAD=X":"USD/CAD", "NZDUSD=X":"NZD/USD", "GC=F":"طلای جهانی (GC)" };
      try {
        const rows = await Promise.all(symbols.map(async symbol => {
          const data = await safeFetchJson("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) + "?range=5d&interval=15m");
          const result = data?.chart?.result?.[0], q = result?.indicators?.quote?.[0], closes = (q?.close || []).filter(x => Number.isFinite(Number(x)));
          if (!result || closes.length < 5) return null;
          const last = closes[closes.length-1], prior = closes[closes.length-5], pct = prior ? (last-prior)/prior*100 : 0;
          const times = result.timestamp || [], t = times.length ? times[times.length-1] : 0;
          return { symbol: labels[symbol], name: labels[symbol], price: last, changePct: pct, direction: direction(pct), score: score(pct), observedAt, dataTime: t ? new Date(t*1000).toISOString() : null, reason: "شتاب قیمت در چهار کندل ۱۵ دقیقه‌ای اخیر", kind: "رصد کوتاه‌مدت", actionable: false };
        }));
        markets.forex.items = rows.filter(Boolean).sort((a,b)=>b.score-a.score);
        markets.forex.ok = markets.forex.items.length > 0;
      } catch (e) { markets.forex.error = String(e?.message || "داده فارکس/طلا در دسترس نیست"); }
    })(),
    (async () => {
      const stablecoins = new Set(["USDT","USDC","BUSD","DAI","TUSD","FDUSD","USDE","USDP","USDD","USD1"]);
      const normalizeCoinlore = rows => rows.filter(x => {
        const symbol = String(x?.symbol || "").toUpperCase();
        return symbol && !stablecoins.has(symbol) && Number(x?.price_usd) > 0 && Number(x?.volume24) >= 5000000;
      }).sort((a,b)=>Number(b.volume24)-Number(a.volume24)).slice(0,60).map(x => {
        const pct = Number(x.percent_change_24h || 0);
        return { symbol: String(x.symbol).toUpperCase()+"/USD", name: x.name || x.symbol, price: Number(x.price_usd), changePct: pct, volume: Number(x.volume24), direction: direction(pct), score: score(pct), observedAt, dataTime: null, reason: "تغییر ۲۴ ساعته و حجم معاملات دلاری؛ داده تجمیعی بازار", kind: "رصد ۲۴ ساعته", actionable: false };
      });
      const normalizeCoinGecko = rows => rows.filter(x => {
        const symbol = String(x?.symbol || "").toUpperCase();
        return symbol && !stablecoins.has(symbol) && Number(x.current_price) > 0 && Number(x.total_volume) >= 5000000;
      }).sort((a,b)=>Number(b.total_volume)-Number(a.total_volume)).slice(0,60).map(x => {
        const pct = Number(x.price_change_percentage_24h || 0);
        return { symbol: String(x.symbol).toUpperCase()+"/USD", name: x.name || x.symbol, price: Number(x.current_price), changePct: pct, volume: Number(x.total_volume), direction: direction(pct), score: score(pct), observedAt, dataTime: x.last_updated || null, reason: "تغییر ۲۴ ساعته و حجم معاملات دلاری؛ داده تجمیعی بازار", kind: "رصد ۲۴ ساعته", actionable: false };
      });
      try {
        const data = await safeFetchJson("https://api.coinlore.net/api/tickers/?start=0&limit=100");
        if (!Array.isArray(data?.data)) throw new Error("CoinLore returned an unexpected response");
        markets.crypto.items = normalizeCoinlore(data.data);
        if (!markets.crypto.items.length) throw new Error("CoinLore returned no qualifying liquid assets");
        markets.crypto.source = "CoinLore public market data";
        markets.crypto.ok = true;
      } catch (primaryError) {
        try {
          const data = await safeFetchJson("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false");
          if (!Array.isArray(data)) throw new Error("CoinGecko returned an unexpected response");
          markets.crypto.items = normalizeCoinGecko(data);
          if (!markets.crypto.items.length) throw new Error("CoinGecko returned no qualifying liquid assets");
          markets.crypto.source = "CoinGecko public market data (fallback)";
          markets.crypto.ok = true;
        } catch (fallbackError) {
          markets.crypto.error = "CoinLore: " + String(primaryError?.message || "unavailable") + " | CoinGecko: " + String(fallbackError?.message || "unavailable");
        }
      }
    })()
  ];
  await Promise.all(jobs);
  const payload = { ok: Object.values(markets).some(m=>m.ok), sourceMode: "free-public", updatedAt: observedAt, disclaimer: "این خروجی غربال اولیه است، نه سیگنال خرید/فروش. داده‌ها ممکن است تأخیری یا ناقص باشند. ورود، حد ضرر و هدف بدون داده تاریخی معتبر محاسبه نمی‌شود.", markets };
  try { if (env.CHAT_STORE) await env.CHAT_STORE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 120 }); } catch (e) { console.error("[BHR_SCANNER_CACHE_WRITE]", e?.message || "cache unavailable"); }
  return json(payload, 200, { ...headers, "Cache-Control": "public, max-age=20" });
}



/* BHR live quotes: Wallex for USDT/BTC and NerkhAra for physical gold/silver + spot references. */
async function handleLivePrices(env, headers) {
  const cacheKey = "bhr:live-prices:v3";
  let cached = null;
  try {
    cached = env.CHAT_STORE ? await env.CHAT_STORE.get(cacheKey, "json") : null;
    if (cached?.updatedAt && Date.now() - Date.parse(cached.updatedAt) < 8000) {
      return json({ ...cached, cached: true }, 200, { ...headers, "Cache-Control": "public, max-age=5" });
    }
  } catch (error) {
    console.error("[BHR_PRICE_CACHE_READ]", error?.message || "cache unavailable");
  }

  const requestHeaders = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
    "Referer": "https://behnamhunter.ir/"
  };
  const fetchJson = async (url, extraHeaders = {}, cacheTtl = 5) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort("provider timeout"), 7000);
    try {
      const response = await fetch(url, {
        headers: { ...requestHeaders, ...extraHeaders },
        signal: controller.signal,
        cf: { cacheTtl, cacheEverything: true }
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  };

  let usdtToman = null, btcUsd = null, usdtChange = 0, btcChange = 0;
  let cryptoSource = null, cryptoError = null;

  // بازار رمزارز مستقل از منبع فلزات دریافت می‌شود.
  try {
    const body = await fetchJson("https://api.bitpin.org/api/v1/mkt/tickers/", { "Referer": "https://bitpin.org/" }, 5);
    const rows = Array.isArray(body) ? body
      : (Array.isArray(body?.results) ? body.results
      : (Array.isArray(body?.data) ? body.data : Object.values(body?.data || body || {})));
    // Bitpin's public ticker payload may identify markets by code, symbol, or market.
    const symbolOf = row => String(row?.symbol || row?.market || row?.code || row?.title || "").toUpperCase().replaceAll("/", "_");
    const findTicker = (...names) => rows.find(row => names.includes(symbolOf(row)));
    const tickerPrice = row => Number(row?.price ?? row?.last ?? row?.price_info?.price ?? row?.order_book_info?.price ?? row?.internal_price_info?.price);
    const usdtDirect = findTicker("USDT_IRT", "USDTIRT", "USDT_TOMAN");
    const btcToman = findTicker("BTC_IRT", "BTC_TOMAN");
    const btc = findTicker("BTC_USDT", "BTCUSDT");
    const directUsdtPrice = tickerPrice(usdtDirect);
    const btcTomanPrice = tickerPrice(btcToman);
    const btcUsdPrice = tickerPrice(btc);
    // If there is no USDT/IRT market, derive Tether/Toman from the two BTC markets.
    const derivedUsdtPrice = btcTomanPrice > 0 && btcUsdPrice > 0 ? btcTomanPrice / btcUsdPrice : null;
    const u = directUsdtPrice > 0 ? directUsdtPrice : derivedUsdtPrice;
    const b = btcUsdPrice;
    if (!(u > 0) || !(b > 0)) throw new Error("Bitpin ticker response did not contain usable BTC/IRT and BTC/USDT prices");
    usdtToman = u;
    btcUsd = b;
    usdtChange = Number(usdtDirect?.daily_change_percentage ?? usdtDirect?.change ?? 0);
    btcChange = Number(btc?.daily_change_percentage ?? btc?.percentage ?? btc?.change ?? 0);
    cryptoSource = "Bitpin";
  } catch (bitpinError) {
    try {
      const body = await fetchJson("https://api.wallex.ir/v1/markets", { "Referer": "https://wallex.ir/" }, 5);
      const symbols = body?.result?.symbols || body?.result?.markets || {};
      const u = Number(symbols.USDTTMN?.stats?.lastPrice);
      const b = Number(symbols.BTCUSDT?.stats?.lastPrice);
      if (!body?.success || !(u > 0) || !(b > 0)) throw new Error("Wallex returned invalid market prices");
      usdtToman = u;
      btcUsd = b;
      usdtChange = Number(symbols.USDTTMN?.stats?.["24h_ch"] ?? 0);
      btcChange = Number(symbols.BTCUSDT?.stats?.["24h_ch"] ?? 0);
      cryptoSource = "Wallex";
    } catch (wallexError) {
      cryptoError = String(wallexError?.message || wallexError);
      console.error("[BHR_CRYPTO_PROVIDER_ERROR]", String(bitpinError?.message || bitpinError), cryptoError);
    }
  }

  // فلزات و نفت در مسیر جداگانه‌اند؛ خطای این منبع قیمت تتر و بیت‌کوین را متوقف نمی‌کند.
  let byId = {}, localUpdatedAt = null, localSourceError = null;
  try {
    const localBody = await fetchJson("https://nerkhara.com/api/v1/latest.json", {}, 20);
    const items = Array.isArray(localBody?.items) ? localBody.items : [];
    byId = Object.fromEntries(items.map(item => [item.id, item]));
    const stamps = items.filter(item => item?.updated_utc)
      .map(item => Date.parse(String(item.updated_utc).endsWith("Z") ? item.updated_utc : item.updated_utc + "Z"))
      .filter(Number.isFinite);
    if (stamps.length) localUpdatedAt = new Date(Math.max(...stamps)).toISOString();
  } catch (error) {
    localSourceError = String(error?.message || error);
    console.error("[BHR_LOCAL_PRICE_PROVIDER_ERROR]", localSourceError);
  }

  const readLocal = id => {
    const item = byId[id];
    const price = Number(item?.price);
    return item && price > 0 && item.unit === "IRT" ? { price, stale: Boolean(item.stale) } : null;
  };
  // اگر API صرافی‌ها از سمت Cloudflare با 403 مسدود بود، از همان پاسخ NerkhAra برای رمزارزها استفاده کن.
  if (!(usdtToman > 0) || !(btcUsd > 0)) {
    const usdtItem = byId.usdt;
    const btcItem = byId.btc;
    const fallbackUsdt = Number(usdtItem?.price);
    const fallbackBtc = Number(btcItem?.price);
    if (usdtItem?.unit === "IRT" && fallbackUsdt > 0 && btcItem?.unit === "USDT" && fallbackBtc > 0) {
      usdtToman = fallbackUsdt;
      btcUsd = fallbackBtc;
      usdtChange = Number(usdtItem?.change_pct ?? 0);
      btcChange = Number(btcItem?.change_pct ?? 0);
      cryptoSource = "NerkhAra";
      cryptoError = null;
    }
  }

  const gold = readLocal("gold-18k");
  const silver = readLocal("silver-999");
  const brentItem = byId.brent;
  const brentUsd = Number(brentItem?.price);
  const xauUsdOz = Number(byId.xau?.price);
  const xagUsdOz = Number(byId.xag?.price);
  const ounceGrams = 31.1034768;

  const hasCrypto = usdtToman > 0 && btcUsd > 0;
  const hasLocalMarkets = Boolean(silver || (brentUsd > 0) || gold);
  if (!hasCrypto && !hasLocalMarkets) {
    if (cached?.data) {
      return json({ ...cached, stale: true, cached: true }, 200, { ...headers, "Cache-Control": "public, max-age=10" });
    }
    return json({
      ok: false,
      error: "دریافت قیمت از منابع بازار ناموفق بود",
      detail: [cryptoError, localSourceError].filter(Boolean).join(" | ").slice(0, 320)
    }, 502, { ...headers, "Cache-Control": "no-store" });
  }

  const payload = {
    ok: true,
    source: {
      crypto: cryptoSource || "unavailable",
      iranMetals: localSourceError ? "unavailable" : "NerkhAra",
      worldMetals: localSourceError ? "unavailable" : "NerkhAra"
    },
    providerErrors: {
      crypto: cryptoError || null,
      metals: localSourceError || null
    },
    updatedAt: new Date().toISOString(),
    localUpdatedAt,
    data: {
      usdt: { toman: usdtToman, usd: 1, change24h: usdtChange, stale: !hasCrypto },
      btc: { toman: hasCrypto ? btcUsd * usdtToman : null, usd: btcUsd, change24h: btcChange, stale: !hasCrypto },
      // منبع و فرمول قیمت طلا فعلاً بدون تغییر نگه داشته شده است.
      gold18k: {
        toman: gold?.price ?? null,
        usd: xauUsdOz > 0 ? xauUsdOz * 0.75 / ounceGrams : null,
        stale: Boolean(gold?.stale)
      },
      silver999: {
        toman: silver?.price ?? null,
        usd: xagUsdOz > 0 ? xagUsdOz * 0.999 / ounceGrams : null,
        stale: Boolean(silver?.stale || localSourceError)
      },
      brent: {
        usd: brentUsd > 0 ? brentUsd : null,
        toman: brentUsd > 0 && usdtToman > 0 ? brentUsd * usdtToman : null,
        stale: Boolean(brentItem?.stale || localSourceError)
      }
    }
  };

  if (env.CHAT_STORE) {
    try { await env.CHAT_STORE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 90 }); }
    catch (error) { console.error("[BHR_PRICE_CACHE_WRITE]", error?.message || "cache unavailable"); }
  }
  return json(payload, 200, { ...headers, "Cache-Control": "public, max-age=5" });
}
/* WebSocket proxy for Binance liquidation stream */
async function handleLiquidationSocket(request) {
  if (request.headers.get("Upgrade") !== "websocket") {
    return new Response("Expected Upgrade: websocket", { status: 426 });
  }

  let upstream;
  try {
    // Cloudflare's documented outbound WebSocket handshake.
    const upstreamResponse = await fetch("https://fstream.binance.com/market/ws/!forceOrder@arr", {
      headers: { Upgrade: "websocket" }
    });
    upstream = upstreamResponse.webSocket;
    if (!upstream) {
      const detail = await upstreamResponse.text().catch(() => "");
      throw new Error("Binance WebSocket handshake failed: HTTP " + upstreamResponse.status + " " + detail.slice(0, 180));
    }
    upstream.accept({ allowHalfOpen: true });
  } catch (error) {
    console.error("[BHR_LIQUIDATION_UPSTREAM_ERROR]", error?.message || "Unknown error");
    return new Response("Binance upstream connection failed", { status: 502 });
  }

  const pair = new WebSocketPair();
  const client = pair[0], server = pair[1];
  server.accept({ allowHalfOpen: true });
  let shuttingDown = false;

  const safeClose = (ws, code, reason) => {
    try {
      if (ws && ws.readyState < WebSocket.CLOSING) {
        const validCode = code === 1000 || (code >= 3000 && code <= 4999);
        if (validCode) ws.close(code, String(reason || "").slice(0, 100));
        else ws.close(1011, "WebSocket proxy closed");
      }
    } catch (_) {}
  };
  const closeBoth = (code = 1011, reason = "Proxy connection closed") => {
    if (shuttingDown) return;
    shuttingDown = true;
    safeClose(upstream, code, reason);
    safeClose(server, code, reason);
  };

  upstream.addEventListener("message", event => {
    if (server.readyState === WebSocket.OPEN) {
      try { server.send(event.data); } catch (_) { closeBoth(); }
    }
  });
  upstream.addEventListener("error", () => closeBoth(1011, "Binance upstream error"));
  upstream.addEventListener("close", () => closeBoth(1011, "Binance upstream disconnected"));

  server.addEventListener("message", event => {
    if (upstream.readyState === WebSocket.OPEN) {
      try { upstream.send(event.data); } catch (_) { closeBoth(); }
    }
  });
  server.addEventListener("close", () => {
    if (shuttingDown) return;
    shuttingDown = true;
    safeClose(upstream, 1000, "Client disconnected");
  });
  server.addEventListener("error", () => closeBoth());

  return new Response(null, { status: 101, webSocket: client });
}

async function testLiquidationUpstream() {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch("https://fstream.binance.com/market/ws/!forceOrder@arr", {
      headers: { Upgrade: "websocket" }
    });
    const socket = response.webSocket;
    if (!socket) {
      const detail = await response.text().catch(() => "");
      return json({
        ok: false,
        stage: "binance_handshake",
        httpStatus: response.status,
        detail: detail.slice(0, 300),
        checkedAt
      }, 502, { "Cache-Control": "no-store" });
    }
    socket.accept({ allowHalfOpen: true });
    try { socket.close(1000, "Diagnostic complete"); } catch (_) {}
    return json({
      ok: true,
      stage: "binance_websocket_handshake",
      httpStatus: response.status,
      message: "Binance WebSocket handshake succeeded",
      checkedAt
    }, 200, { "Cache-Control": "no-store" });
  } catch (error) {
    console.error("[BHR_LIQUIDATION_DIAGNOSTIC_ERROR]", error?.message || "Unknown error");
    return json({
      ok: false,
      stage: "worker_fetch",
      error: String(error?.message || "Unknown error").slice(0, 300),
      checkedAt
    }, 502, { "Cache-Control": "no-store" });
  }
}

export default {

  async fetch(request, env) {

    const url = new URL(request.url);

    const path = url.pathname;

    const origin = request.headers.get("Origin") || "";

    const headers = corsHeaders(origin);



    if (path === "/liquidations") {
      return handleLiquidationSocket(request);
    }

    if (path === "/telegram-webhook") {

      return handleTelegramWebhook(request, env);

    }



    // Public, read-only market data may also be opened directly for diagnostics.
    const publicMarketMapRead = path === "/market-map" && request.method === "GET" && !origin;
    const publicCalendarRead = path === "/economic-calendar" && request.method === "GET" && !origin;
    const publicScannerRead = path === "/opportunity-scanner" && request.method === "GET" && !origin;
    const publicLivePricesRead = path === "/live-prices" && request.method === "GET" && !origin;

    if (!ALLOWED_ORIGINS.includes(origin) && !publicMarketMapRead && !publicCalendarRead && !publicScannerRead && !publicLivePricesRead) {

      return new Response("Forbidden", { status: 403 });

    }



    /* شمارنده بازدیدکنندگان؛ مقدار اولیه ۳۰۴ */
    if (path === "/visitor-count") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
      if (!env.CHAT_STORE) return json({ ok: false, error: "Storage unavailable" }, 503, headers);
      try {
        const key = "bhr:visitor-count:v1";
        const current = Number(await env.CHAT_STORE.get(key));
        const stored = Number.isFinite(current) && current >= 304 ? current : 304;
        if (url.searchParams.get("mode") === "read") {
          if (!Number.isFinite(current) || current < 304) await env.CHAT_STORE.put(key, "304");
          return json({ ok: true, count: stored }, 200, { ...headers, "Cache-Control": "no-store" });
        }
        const next = stored + 1;
        await env.CHAT_STORE.put(key, String(next));
        return json({ ok: true, count: next }, 200, { ...headers, "Cache-Control": "no-store" });
      } catch (error) {
        console.error("[BHR_VISITOR_COUNT_ERROR]", error?.message || "Unknown error");
        return json({ ok: false, error: "Counter unavailable" }, 500, headers);
      }
    }

    if (request.method === "OPTIONS") {

      return new Response(null, {

        status: 204,

        headers

      });

    }



    /* دستیار هوشمند */

    if (path === "/ai") {

      if (request.method !== "POST") {

        return new Response("Method not allowed", {

          status: 405,

          headers

        });

      }



      return handleAI(request, env, headers);

    }



    /* تقویم اقتصادی Helious؛ داده رایگان با تأخیر حدود یک ساعت */
    if (path === "/economic-calendar") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
      const cacheKey = "bhr:helious:calendar:v2";
      let cached = null;
      try { cached = await env.CHAT_STORE.get(cacheKey, "json"); } catch (e) {
        console.error("[BHR_CALENDAR_CACHE_READ_ERROR]", e?.message || "Unknown error");
      }
      const cachedAge = cached?.updatedAt ? Date.now() - new Date(cached.updatedAt).getTime() : Infinity;
      if (cached && Array.isArray(cached.data) && cachedAge < 55 * 60 * 1000) {
        return json(cached, 200, { ...headers, "Cache-Control": "public, max-age=300" });
      }
      try {
        // Use a dedicated free Helious key when configured; otherwise use the shared sample quota.
        const upstreamUrl = "https://api.helious.io/v1/calendar?days_ahead=7&days_back=1&detail=full";
        const upstreamHeaders = {
          "Accept": "application/json",
          "User-Agent": "BEHNAM-HUNTING-ROOM/1.0 (+https://behnamhunter.ir)"
        };
        if (env.HELIOUS_API_KEY) upstreamHeaders["X-Api-Key"] = env.HELIOUS_API_KEY;
        const response = await fetch(upstreamUrl, {
          headers: upstreamHeaders,
          cf: { cacheTtl: 300, cacheEverything: true }
        });
        const body = await response.text();
        if (!response.ok) throw new Error("Helious HTTP " + response.status + (body ? ": " + body.slice(0, 240).replace(/\s+/g, " ") : ""));
        let result;
        try { result = JSON.parse(body); } catch (_) { throw new Error("Helious returned invalid JSON: " + body.slice(0, 180)); }
        const root = result?.data;
        const sourceRows = Array.isArray(root) ? root :
          Array.isArray(root?.events) ? root.events :
          Array.isArray(root?.calendar) ? root.calendar :
          Array.isArray(root?.rows) ? root.rows :
          Array.isArray(root?.items) ? root.items :
          Array.isArray(result?.events) ? result.events :
          Array.isArray(result?.calendar) ? result.calendar :
          Array.isArray(result?.rows) ? result.rows : [];
        if (!sourceRows.length) {
          const err = result?.error?.message || result?.error?.code || result?.message || result?.summary || "No event rows in API response";
          throw new Error("Helious response shape not recognized: " + String(err).slice(0, 180));
        }
        const data = sourceRows.filter(event => event && (event.datetime_utc || event.datetime || event.date_utc) && (event.title || event.event || event.name)).map(event => ({
          scheduledAt: event.datetime_utc || event.datetime || event.date_utc,
          eventName: event.title || event.event || event.name,
          currency: event.currency || event.country || "",
          country: event.country || "",
          periodLabel: event.period || "",
          impact: event.impact || "Low",
          previous: event.previous_value ?? event.previous ?? "",
          forecast: event.forecast_value ?? event.forecast ?? "",
          actual: event.actual_value ?? event.actual ?? "",
          status: event.status || "",
          surprise: event.surprise || "",
          sigma: event.sigma ?? null,
          source: "Helious"
        }));
        if (!data.length) throw new Error("Helious returned " + sourceRows.length + " rows but none had usable event fields");
        const payload = {
          ok: true, source: "Helious", updatedAt: new Date().toISOString(),
          delaySec: Number(result?.meta?.delay_sec ?? 3600),
          tier: result?.meta?.tier || "sample", summary: result?.summary || "", data
        };
        try { await env.CHAT_STORE.put(cacheKey, JSON.stringify(payload), { expirationTtl: 7200 }); } catch (e) {
          console.error("[BHR_CALENDAR_CACHE_WRITE_ERROR]", e?.message || "Unknown error");
        }
        return json(payload, 200, { ...headers, "Cache-Control": "public, max-age=300" });
      } catch (error) {
        console.error("[BHR_HELIOUS_CALENDAR_ERROR]", error?.message || "Unknown error");
        if (cached && Array.isArray(cached.data)) {
          return json({ ...cached, stale: true }, 200, { ...headers, "Cache-Control": "public, max-age=120" });
        }
        return json({
          ok: false, error: "Helious economic calendar unavailable",
          detail: String(error?.message || "Unknown error").slice(0, 320)
        }, 502, headers);
      }
    }

    /* اسکنر فرصت‌های بازار؛ داده‌های عمومی و فقط برای رصد اولیه */
    if (path === "/opportunity-scanner") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
      return handleOpportunityScanner(env, headers);
    }

    /* قیمت زنده تتر، بیت‌کوین، طلای ۱۸ عیار و نقره ۹۹۹ */
    if (path === "/live-prices") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
      return handleLivePrices(env, headers);
    }

    /* شاخص کل بورس تهران؛ شاخص منتخب با مسیر جایگزین نمای کلی بازار */
    if (path === "/market-index") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
      const sourceHeaders = {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.tsetmc.com/"
      };
      try {
        let result = null;
        let sourceError = "";
        try {
          const response = await fetch("https://cdn.tsetmc.com/api/Index/GetIndexB1LastAll/SelectedIndexes/1", {
            headers: sourceHeaders,
            cf: { cacheTtl: 8, cacheEverything: true }
          });
          if (!response.ok) throw new Error("SelectedIndexes HTTP " + response.status);
          const body = await response.json();
          const indices = Array.isArray(body) ? body : (Array.isArray(body?.indexB1) ? body.indexB1 : []);
          const row = indices.find(item => String(item?.lVal30 || "").replace(/[\s\u200c\u200f]+/g, " ").trim() === "شاخص کل")
            || indices.find(item => String(item?.lVal30 || "").includes("شاخص کل") && !String(item?.lVal30 || "").includes("هم وزن"));
          if (row) {
            const value = Number(row.xDrNivJIdx004);
            const change = Number(row.indexChange ?? 0);
            const percent = Number(row.xVarIdxJRfV ?? (value > change && value > 0 ? change / (value - change) * 100 : 0));
            if (Number.isFinite(value) && value > 0) {
              result = { name: String(row.lVal30 || "شاخص کل"), value, change, percent, time: String(row.hEven || "") };
            }
          }
          if (!result) throw new Error("شاخص کل در فهرست منتخب پیدا نشد یا مقدار آن نامعتبر بود");
        } catch (error) {
          sourceError = String(error?.message || error);
        }

        if (!result) {
          const response = await fetch("https://cdn.tsetmc.com/api/MarketData/GetMarketOverview/1", {
            headers: sourceHeaders,
            cf: { cacheTtl: 8, cacheEverything: true }
          });
          if (!response.ok) throw new Error("SelectedIndexes: " + sourceError + "; MarketOverview HTTP " + response.status);
          const body = await response.json();
          const overview = body?.marketOverview || body;
          const value = Number(overview?.indexLastValue);
          const change = Number(overview?.indexChange);
          if (!Number.isFinite(value) || value <= 0) throw new Error("SelectedIndexes: " + sourceError + "; مقدار شاخص در MarketOverview معتبر نیست");
          const previous = value - change;
          const percent = previous > 0 ? change / previous * 100 : 0;
          result = {
            name: "شاخص کل",
            value,
            change: Number.isFinite(change) ? change : 0,
            percent,
            time: String(overview?.marketActivityHEven ?? overview?.lastDataHEven ?? "")
          };
        }

        return json({ ok: true, ...result, updatedAt: new Date().toISOString() }, 200, {
          ...headers, "Cache-Control": "public, max-age=8"
        });
      } catch (error) {
        console.error("[BHR_MARKET_INDEX_ERROR]", error?.message || "Unknown error");
        return json({ ok: false, error: "دریافت شاخص کل از TSETMC ناموفق بود", detail: String(error?.message || "Unknown error").slice(0, 240) }, 502, {
          ...headers, "Cache-Control": "no-store"
        });
      }
    }

    /* پراکسی امن نقشه حرارتی بورس ایران */
    if (path === "/market-map") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers
        });
      }

      try {
        const requestHeaders = {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://www.tsetmc.com/"
        };

        // ابتدا API رسمی نقشه بازار را امتحان می‌کنیم.
        const mapResponse = await fetch(
          "https://cdn.tsetmc.com/api/ClosingPrice/GetMarketMap?market=0&size=1920&sector=0&typeSelected=1&hEven=0",
          { headers: requestHeaders }
        );

        if (!mapResponse.ok) {
          console.error("[BHR_MARKET_MAP_ERROR]", "GetMarketMap", mapResponse.status);
        } else {
          const mapData = await mapResponse.json();
          if (Array.isArray(mapData) && mapData.length > 0) {
            return json(mapData, 200, {
              ...headers,
              "Cache-Control": "public, max-age=20"
            });
          }
        }

        // اگر نقشه خالی بود، از API فهرست نمادهای بازار استفاده می‌کنیم.
        const watchUrl = "https://cdn.tsetmc.com/api/ClosingPrice/GetMarketWatch?market=0&industrialGroup=&paperTypes%5B0%5D=1&paperTypes%5B1%5D=2&paperTypes%5B2%5D=3&paperTypes%5B3%5D=4&paperTypes%5B4%5D=5&paperTypes%5B5%5D=6&paperTypes%5B6%5D=7&paperTypes%5B7%5D=8&paperTypes%5B8%5D=9&showTraded=false&withBestLimits=false&hEven=0&RefID=0";
        const watchResponse = await fetch(watchUrl, { headers: requestHeaders });

        if (!watchResponse.ok) {
          console.error("[BHR_MARKET_MAP_ERROR]", "GetMarketWatch", watchResponse.status);
          return json({
            ok: false,
            error: "Iranian market data source unavailable",
            source: "GetMarketWatch",
            status: watchResponse.status
          }, 502, headers);
        }

        const watchData = await watchResponse.json();
        const rows = Array.isArray(watchData)
          ? watchData
          : (watchData && Array.isArray(watchData.marketwatch) ? watchData.marketwatch : []);

        if (!rows.length) {
          return json({
            ok: false,
            error: "Iranian market data source returned no symbols",
            source: "GetMarketWatch",
            count: 0
          }, 503, headers);
        }

        return json(rows, 200, {
          ...headers,
          "Cache-Control": "public, max-age=20"
        });
      } catch (error) {
        console.error("[BHR_MARKET_MAP_ERROR]", error?.message || "Unknown error");
        return json({
          ok: false,
          error: "Could not retrieve Iranian market data"
        }, 502, headers);
      }
    }

    /* دریافت پیام‌های چت */

    if (request.method === "GET" && path === "/messages") {

      const conversationId = url.searchParams.get("conversationId") || "";



      if (!/^[a-zA-Z0-9-]{16,80}$/.test(conversationId)) {

        return json({

          ok: false,

          error: "Invalid conversation ID"

        }, 400, headers);

      }



      try {

        const messages = await env.CHAT_STORE.get(

          `conv:${conversationId}`,

          "json"

        ) || [];



        return json({

          ok: true,

          messages,

          serverTime: Date.now()

        }, 200, headers);



      } catch (error) {

        console.error("[BHR_MESSAGES_ERROR]", error?.message || "Unknown error");



        return json({

          ok: false,

          error: "Storage error"

        }, 500, headers);

      }

    }



    /* دانلود یا مشاهده فایل دریافتی از تلگرام */

    if (request.method === "GET" && path === "/attachment") {

      const conversationId = url.searchParams.get("conversationId") || "";

      const fileId = url.searchParams.get("fileId") || "";



      if (!/^[a-zA-Z0-9-]{16,80}$/.test(conversationId) ||

          !/^[a-zA-Z0-9-]{16,80}$/.test(fileId)) {

        return json({

          ok: false,

          error: "Invalid attachment request"

        }, 400, headers);

      }



      try {

        const meta = await env.CHAT_STORE.get(

          `attmeta:${fileId}`,

          "json"

        );



        if (!meta || meta.conversationId !== conversationId) {

          return json({

            ok: false,

            error: "Attachment not found"

          }, 404, headers);

        }



        const file = await env.CHAT_STORE.get(

          `att:${fileId}`,

          "arrayBuffer"

        );



        if (!file) {

          return json({

            ok: false,

            error: "File expired or not found"

          }, 404, headers);

        }



        const mime = meta.mime || "application/octet-stream";

        const filename = safeFilename(meta.name || "attachment");



        return new Response(file, {

          status: 200,

          headers: {

            ...headers,

            "Content-Type": mime,

            "Content-Length": String(file.byteLength),

            "Content-Disposition": `inline; filename="${filename.replace(/["\\]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,

            "Cache-Control": "private, no-store",

            "X-Content-Type-Options": "nosniff"

          }

        });



      } catch (error) {

        console.error("[BHR_ATTACHMENT_ERROR]", error?.message || "Unknown error");



        return json({

          ok: false,

          error: "Attachment retrieval failed"

        }, 500, headers);

      }

    }



    /* ارسال پیام یا فایل از سایت به تلگرام */

    if (request.method === "POST" && path === "/") {

      try {

        const data = await request.json();



        const message = String(data.message || "").trim();

        const name = String(data.name || "بازدیدکننده").trim();

        const phone = String(data.phone || "").trim();

        const attachment = data.attachment || null;



        if ((!message && !attachment) ||

            message.length > 2000 ||

            name.length > 100 ||

            phone.length > 40) {

          return json({

            ok: false,

            error: "Invalid input"

          }, 400, headers);

        }



        let conversationId = String(data.conversationId || "");



        if (!/^[a-zA-Z0-9-]{16,80}$/.test(conversationId)) {

          conversationId = crypto.randomUUID();

        }



        const caption =

          `پیام جدید از سایت اتاق شکار\n` +

          `شناسه گفت‌وگو: ${conversationId}\n\n` +

          `نام: ${name}\n` +

          `تلفن: ${phone || "ثبت نشده"}\n\n` +

          `پیام:\n${message || "فایل پیوست‌شده است."}\n\n` +

          `برای پاسخ، روی همین پیام در تلگرام Reply بزنید.`;



        const telegramResult = attachment

          ? await telegramSendDocument(env, caption, attachment)

          : await telegramSend(env, caption, true);



        if (!telegramResult.ok) {

          console.error(

            "[BHR_TELEGRAM_SEND_ERROR]",

            telegramResult.description || "Telegram send failed"

          );



          return json({

            ok: false,

            error: "Telegram delivery failed"

          }, 502, headers);

        }



        const telegramMessageId = telegramResult.result.message_id;



        await env.CHAT_STORE.put(

          `tgmsg:${telegramMessageId}`,

          conversationId,

          { expirationTtl: TTL_SECONDS }

        );



        return json({

          ok: true,

          conversationId,

          telegramMessageId

        }, 200, headers);



      } catch (error) {

        console.error("[BHR_SUPPORT_SEND_ERROR]", error?.message || "Unknown error");



        return json({

          ok: false,

          error: "Server error"

        }, 500, headers);

      }

    }



    return new Response("Not found", {

      status: 404,

      headers

    });

  }

};