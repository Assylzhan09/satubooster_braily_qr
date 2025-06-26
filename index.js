global.crypto = require('crypto');

const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  downloadMediaMessage 
} = require('@whiskeysockets/baileys');
const fetch = require('node-fetch');
const express = require('express');
const fs = require('fs');

const app = express();
app.use(express.json());

let sock;
let latestQR = null;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update;
    if (qr) {
      latestQR = qr;
      console.log('📱 Новый QR-код для входа:');
      console.log(qr);
    }

    if (connection === 'open') {
      console.log('✅ Подключено к WhatsApp!');
    }

    if (connection === 'close') {
      console.log('❌ Соединение закрыто. Перезапуск...');
      setTimeout(startBot, 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const from = msg.key.remoteJid;

    // === ГОЛОСОВОЕ (АУДИО) ===
    if (msg.message.audioMessage) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          "buffer",
          {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        );
        const audioData = buffer.toString('base64');
        const mimeType = msg.message.audioMessage.mimetype || 'audio/ogg';

        const payload = {
          entry: [{
            changes: [{
              value: {
                messages: [{
                  from,
                  audio: { data: audioData, mime_type: mimeType }
                }]
              }
            }]
          }]
        };

        fs.appendFileSync("node_log.txt", JSON.stringify(payload) + "\n");
        await fetch('https://satucrm.satubooster.kz/antitarakan-partner/webhook.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return;
      } catch (err) {
        console.error('Ошибка при загрузке аудио:', err);
        return;
      }
    }

    // === ИЗОБРАЖЕНИЕ или ДОКУМЕНТ ===
    if (msg.message.imageMessage || msg.message.documentMessage) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          "buffer",
          {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        );
        const base64File = buffer.toString('base64');
        let payloadMsg = { from };

        if (msg.message.imageMessage) {
          payloadMsg.image = { data: base64File };
        }
        if (msg.message.documentMessage) {
          payloadMsg.document = {
            data: base64File,
            mime_type: msg.message.documentMessage.mimetype
          };
        }

        const payload = {
          entry: [{
            changes: [{
              value: {
                messages: [payloadMsg]
              }
            }]
          }]
        };

        fs.appendFileSync("node_log.txt", JSON.stringify(payload) + "\n");
        await fetch('https://satucrm.satubooster.kz/antitarakan-partner/webhook.php', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return;
      } catch (err) {
        console.error('Ошибка при загрузке файла:', err);
        return;
      }
    }

    // === ТЕКСТ ===
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (text) {
      const payload = {
        entry: [{
          changes: [{
            value: {
              messages: [{
                from,
                text: { body: text }
              }]
            }
          }]
        }]
      };

      fs.appendFileSync("node_log.txt", JSON.stringify(payload) + "\n");
      await fetch('https://satucrm.satubooster.kz/antitarakan-partner/webhook.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }
  });
}

startBot();

// === QR-код API ===
app.get('/qr', (req, res) => {
  if (latestQR) {
    res.json({ qr: latestQR });
  } else {
    res.status(404).json({ error: 'QR-код недоступен' });
  }
});

// === Отправка сообщений API ===
app.get('/send.php', async (req, res) => {
  const { to, text, image } = req.query;

  if (!to) return res.status(400).send('❌ Не указан параметр "to"');
  if (!sock) return res.status(500).send('❌ sock не инициализирован');

  try {
    if (image) {
      await sock.sendMessage(to, {
        image: { url: image },
        caption: text || 'Анти-Таракан — 10 000 ₸. Жеткізу тегін!'
      });
      return res.send('✅ Фото отправлено');
    }

    if (text) {
      await sock.sendMessage(to, { text });
      return res.send('✅ Текст отправлен');
    }

    res.status(400).send('❌ Нет text или image');
  } catch (err) {
    console.error('❌ Ошибка отправки:', err);
    res.status(500).send('❌ Ошибка при отправке');
  }
});

// === Проверка API ===
app.get('/test', (req, res) => {
  res.send('✅ Node.js работает');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 Web API слушает на http://0.0.0.0:3000');
});
