import { config } from '../src/config.js';

if (!config.telegramBotToken) {
  console.error('Renseigne TELEGRAM_BOT_TOKEN dans server/.env.');
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getUpdates`, { signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok || body.ok !== true) throw new Error(`Réponse Telegram ${response.status}`);
    const chats = [...new Map((body.result || []).flatMap((update) => {
      const chat = update.message?.chat || update.my_chat_member?.chat;
      return chat ? [[String(chat.id), { id: chat.id, name: chat.title || chat.first_name || chat.username || 'chat' }]] : [];
    })).values()];
    if (!chats.length) console.log('Aucun chat trouvé. Envoie /start au bot dans Telegram, puis relance cette commande.');
    else for (const chat of chats) console.log(`${chat.name} : TELEGRAM_CHAT_ID=${chat.id}`);
  } catch {
    console.error('Impossible de lire les chats Telegram. Vérifie le token et la connexion réseau.');
    process.exitCode = 1;
  }
}
