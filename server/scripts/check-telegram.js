import { config } from '../src/config.js';
import { sendTelegramMessage, telegramConfigured } from '../src/telegram.js';

if (!telegramConfigured()) {
  console.error('Renseigne TELEGRAM_BOT_TOKEN dans server/.env.');
  process.exitCode = 1;
} else {
  const result = await sendTelegramMessage('RobloxAssetsCreator — test Telegram réussi. Le bot est prêt à envoyer les alertes et le statut horaire.');
  if (result.delivered) console.log('Message de test envoyé sur Telegram.');
  else {
    console.error('Envoi Telegram impossible :', result.reason === 'waiting_for_start' ? 'envoie /start au bot puis relance le test' : result.reason === 'multiple_chats' ? 'plusieurs chats détectés ; précise TELEGRAM_CHAT_ID' : result.reason);
    process.exitCode = 1;
  }
}
