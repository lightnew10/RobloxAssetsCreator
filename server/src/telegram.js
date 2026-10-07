import { config } from './config.js';

export async function sendCriticalAlert(message) {
  if (!config.telegramBotToken || !config.telegramChatId) return { delivered: false, reason: 'not_configured' };
  try {
    const response = await fetch('https://api.telegram.org/bot' + config.telegramBotToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text: String(message).slice(0, 3500), disable_web_page_preview: true }),
    });
    return { delivered: response.ok, reason: response.ok ? null : 'http_' + response.status };
  } catch (cause) {
    return { delivered: false, reason: cause.message };
  }
}
