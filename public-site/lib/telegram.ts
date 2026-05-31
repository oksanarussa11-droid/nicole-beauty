export function escMd(s: string): string {
  return String(s || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

export async function notifyAdmin(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: 'MarkdownV2'
      }),
      signal: controller.signal
    });
  } catch (e) {
    console.error('Telegram notification failed:', e);
  } finally {
    clearTimeout(timeout);
  }
}
