export default async function handler(req, res) {
  const TARGET_HOST = 'mohammadrezaj.dpdns.org';
  const TARGET_BASE = `https://${TARGET_HOST}/wp`;

  // ساخت URL مقصد
  const targetUrl = `${TARGET_BASE}${req.url}`;

  // هدرهایی که باید از درخواست اصلی حذف شن
  const skipRequestHeaders = new Set([
    'host',
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-vercel-id',
    'x-vercel-forwarded-for',
  ]);

  // فیلتر کردن هدرهای درخواست
  const forwardHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!skipRequestHeaders.has(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }
  forwardHeaders['host'] = TARGET_HOST;

  try {
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders,
      redirect: 'manual', // ریدایرکت‌ها رو خودمون مدیریت می‌کنیم
    };

    // body رو فقط برای متدهایی که نیاز دارن بفرست
    if (!['GET', 'HEAD'].includes(req.method)) {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      fetchOptions.body = Buffer.concat(chunks);
    }

    const response = await fetch(targetUrl, fetchOptions);

    // هدرهایی که نباید منتقل بشن
    const skipResponseHeaders = new Set([
      'content-encoding',
      'transfer-encoding',
      'connection',
      'keep-alive',
      'upgrade',
      'x-powered-by',
    ]);

    // انتقال هدرهای پاسخ
    for (const [key, value] of response.headers.entries()) {
      if (!skipResponseHeaders.has(key.toLowerCase())) {
        // هدر location رو برای ریدایرکت‌ها اصلاح کن
        if (key.toLowerCase() === 'location') {
          const fixedLocation = value
            .replace(`https://${TARGET_HOST}/wp`, '')
            .replace(`https://${TARGET_HOST}`, '');
          res.setHeader(key, fixedLocation || '/');
          continue;
        }
        // کوکی‌ها: دامنه رو حذف کن تا روی پروکسی کار کنن
        if (key.toLowerCase() === 'set-cookie') {
          const cookies = Array.isArray(value) ? value : [value];
          const fixedCookies = cookies.map(cookie =>
            cookie
              .replace(/;\s*domain=[^;]*/gi, '')
              .replace(/;\s*secure/gi, '; Secure')
          );
          res.setHeader(key, fixedCookies);
          continue;
        }
        res.setHeader(key, value);
      }
    }

    res.status(response.status);

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      // دریافت HTML و جایگزینی URLها
      let body = await response.text();

      // جایگزینی همه حالت‌های ممکن URL سایت اصلی
      const proxyHost = req.headers.host;
      body = body
        .replaceAll(`https://${TARGET_HOST}/wp`, `https://${proxyHost}`)
        .replaceAll(`https://${TARGET_HOST}`, `https://${proxyHost}`)
        .replaceAll(`http://${TARGET_HOST}/wp`, `https://${proxyHost}`)
        .replaceAll(`http://${TARGET_HOST}`, `https://${proxyHost}`)
        // جایگزینی URLهای نسبی وردپرس در JSON داخل HTML
        .replaceAll(
          `\\/\\/${TARGET_HOST}\\/wp`,
          `\\/\\/${proxyHost}`
        );

      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.send(body);

    } else if (
      contentType.includes('text/css') ||
      contentType.includes('application/javascript') ||
      contentType.includes('text/javascript') ||
      contentType.includes('application/json')
    ) {
      // CSS، JS و JSON هم ممکنه URL داشته باشن
      let body = await response.text();
      const proxyHost = req.headers.host;
      body = body
        .replaceAll(`https://${TARGET_HOST}/wp`, `https://${proxyHost}`)
        .replaceAll(`https://${TARGET_HOST}`, `https://${proxyHost}`);

      res.send(body);

    } else {
      // فایل‌های باینری (تصاویر، فونت‌ها و غیره)
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    }

  } catch (error) {
    console.error('Proxy error:', error);
    res.status(502).json({ error: 'Bad Gateway', message: error.message });
  }
}
