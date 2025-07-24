global.crypto = require('crypto');

const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage
} = require('@whiskeysockets/baileys');
const fetch = (...args) => import('node-fetch').then(mod => mod.default(...args));
const express = require('express');
const fs = require('fs');

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  next();
});
app.use(express.json());

let sock;
let latestQR = null;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, qr }) => {
    if (qr) latestQR = qr;
    if (connection === 'open') console.log('✅ Подключено к WhatsApp!');
    if (connection === 'close') {
      console.log('❌ Соединение закрыто. Перезапуск...');
      setTimeout(startBot, 2000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;

    // --- Аудио
    if (msg.message.audioMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {}, {
          logger: console,
          reuploadRequest: sock.updateMediaMessage
        });
        const audioData = buffer.toString('base64');
        const mimeType = msg.message.audioMessage.mimetype || 'audio/ogg';

        await sendToWebhook({ from, audio: { data: audioData, mime_type: mimeType } });
      } catch (err) {
        console.error('Ошибка при загрузке аудио:', err);
      }
      return;
    }

    // --- Фото или файл
    if (msg.message.imageMessage || msg.message.documentMessage) {
      try {
        const buffer = await downloadMediaMessage(msg, "buffer", {}, {
          logger: console,
          reuploadRequest: sock.updateMediaMessage
        });
        const base64File = buffer.toString('base64');
        const payloadMsg = { from };

        if (msg.message.imageMessage) payloadMsg.image = { data: base64File };
        if (msg.message.documentMessage) {
          payloadMsg.document = {
            data: base64File,
            mime_type: msg.message.documentMessage.mimetype
          };
        }

        await sendToWebhook(payloadMsg);
      } catch (err) {
        console.error('Ошибка при загрузке файла:', err);
      }
      return;
    }

    // --- Текст
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
    if (text) {
      await sendToWebhook({ from, text: { body: text } });
    }
  });
}

async function sendToWebhook(message) {
  const payload = {
    entry: [{ changes: [{ value: { messages: [message] } }] }]
  };
  fs.appendFileSync("node_log.txt", JSON.stringify(payload) + "\n");

  await fetch('https://satucrm.satubooster.kz/vivood_tau_partner/webhook.php', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

startBot();

// === API ===
app.get('/qr', (req, res) => {
  if (latestQR) return res.json({ qr: latestQR });
  res.status(404).json({ error: 'QR-код недоступен' });
});

app.get('/send', async (req, res) => {
  const { to, text, image } = req.query;
  if (!to) return res.status(400).send('❌ Не указан "to"');
  if (!sock) return res.status(500).send('❌ sock не инициализирован');

  try {
    if (image) {
      await sock.sendMessage(to, {
        image: { url: image },
        caption: text || ''
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

app.get('/test', (req, res) => {
  res.send('✅ Node.js работает');
});

// === API logout для отключения Baileys ===
app.post('/logout', async (req, res) => {
  try {
    if (sock) {
      await sock.logout();
      res.send('✅ Baileys отключён');
      // Можешь добавить обнуление переменных если нужно
      sock = null;
      latestQR = null;
    } else {
      res.status(400).send('❌ Не подключено');
    }
  } catch (e) {
    res.status(500).send('Ошибка: ' + e);
  }
});

app.listen(3003, '0.0.0.0', () => {
  console.log('🌐 Web API слушает на http://0.0.0.0:3003');
});
