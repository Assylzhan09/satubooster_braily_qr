global.crypto = require('crypto');

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
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
      console.log('📱 Новый QR-код:');
      console.log(qr);
    }

    if (connection === 'open') {
      console.log('✅ Подключено к WhatsApp');
    }

    if (connection === 'close') {
      console.log('❌ Соединение закрыто. Перезапуск...');
      startBot();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';

    let payload = {
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

    // 🎙 Обработка голосового
    const { downloadMediaMessage } = require('@whiskeysockets/baileys'); // добавь в начало файла

    if (msg.message.audioMessage) {
      try {
        const buffer = await downloadMediaMessage(
          msg,
          "buffer",
          {},
          { logger: console, reuploadRequest: sock.updateMediaMessage }
        );

        // Сохраняем во временный файл
        const fs = require('fs');
        const tmpFile = `/tmp/audio-${Date.now()}.ogg`;
        fs.writeFileSync(tmpFile, buffer);

        const audioData = fs.readFileSync(tmpFile).toString('base64');

        payload.entry[0].changes[0].value.messages[0].audio = {
          data: audioData,
          mime_type: msg.message.audioMessage.mimetype || 'audio/ogg'
        };
      } catch (err) {
        console.error('Ошибка при загрузке аудио:', err);
      }
    }

    // Лог
    fs.appendFileSync("node_log.txt", JSON.stringify(payload) + "\n");

    // Отправка в webhook
    await fetch('https://satucrm.satubooster.kz/antitarakan-partner/webhook.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  });
}

startBot();

// 📡 QR-код API
app.get('/qr', (req, res) => {
  if (latestQR) {
    res.json({ qr: latestQR });
  } else {
    res.status(404).json({ error: 'QR-код недоступен' });
  }
});

// 📤 Отправка сообщений
app.get('/send.php', async (req, res) => {
  const { to, text, image } = req.query;

  console.log('📨 send.php запрос:', { to, text, image });

  if (!to) return res.status(400).send('❌ Не указан параметр "to"');
  if (!sock) return res.status(500).send('❌ sock не инициализирован');

  try {
    if (image) {
      await sock.sendMessage(to, {
        image: { url: image },
        caption: text || 'Анти-Таракан — 10 000 ₸. Жеткізу тегін!'
      });
      console.log('✅ Фото отправлено');
      return res.send('✅ Фото отправлено');
    }

    if (text) {
      await sock.sendMessage(to, { text });
      console.log('✅ Текст отправлен');
      return res.send('✅ Текст отправлен');
    }

    res.status(400).send('❌ Нет text или image');
  } catch (err) {
    console.error('❌ Ошибка отправки:', err);
    res.status(500).send('❌ Ошибка при отправке');
  }
});

// 🔧 Проверка API
app.get('/test', (req, res) => {
  res.send('✅ Node.js работает');
});

app.listen(3000, '0.0.0.0', () => {
  console.log('🌐 Web API слушает на http://0.0.0.0:3000')
})
