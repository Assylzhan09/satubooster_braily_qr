global.crypto = require('crypto'); // добавляем глобальный модуль crypto

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const fetch = require('node-fetch')
const express = require('express')

const app = express()
app.use(express.json())

let sock // сокет WhatsApp
let latestQR = null // последний QR-код

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth')
  sock = makeWASocket({ auth: state })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, qr } = update
    if (qr) {
      latestQR = qr
      console.log('📱 Новый QR-код (отсканируй через WhatsApp):')
      console.log(qr)
    }

    if (connection === 'open') {
      console.log('✅ Успешно подключено к WhatsApp!')
    }

    if (connection === 'close') {
      console.log('❌ Соединение закрыто. Перезапуск...')
      startBot()
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return

    // 🛡️ Пропускаем исходящие сообщения от самого бота
    if (msg.key.fromMe) return

    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    const from = msg.key.remoteJid

    console.log(`📩 ${from}: ${text}`)

    // Отправляем в webhook
    await fetch('https://satucrm.satubooster.kz/antitarakan-partner/webhook.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry: [{
          changes: [{
            value: {
              messages: [{
                from: from,
                text: { body: text }
              }]
            }
          }]
        }]
      })
    })
  })
}

startBot()

// 📡 API для получения текущего QR-кода
app.get('/qr', (req, res) => {
  if (latestQR) {
    res.json({ qr: latestQR })
  } else {
    res.status(404).json({ error: 'QR-код недоступен' })
  }
})

// 📤 API для отправки сообщений
app.get('/send.php', async (req, res) => {
  const { to, text, image } = req.query;

  if (!to) {
    return res.status(400).send('❌ Не указан параметр "to"');
  }

  try {
    // Если есть фото — отправляем фото
    if (image) {
      await sock.sendMessage(to, {
        image: { url: image },
        caption: text || 'Анти-Таракан — 10 000 ₸. Жеткізу тегін!'
      });
      return res.send('✅ Фото отправлено');
    }

    // Если только текст
    if (text) {
      await sock.sendMessage(to, { text });
      return res.send('✅ Текст отправлен');
    }

    res.status(400).send('❌ Ничего не отправлено (нет text и image)');
  } catch (err) {
    console.error('Ошибка при отправке:', err);
    res.status(500).send('❌ Ошибка при отправке');
  }
});

app.listen(3000, () => {
  console.log('🌐 Web API слушает на http://localhost:3000')
})
