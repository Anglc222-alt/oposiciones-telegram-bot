const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const PORT = process.env.PORT || 3000;

if (!TELEGRAM_TOKEN || !CLAUDE_API_KEY) {
    console.error('❌ Faltan variables de entorno');
    process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_TOKEN, {polling: true});
const app = express();

app.get('/', (req, res) => {
    res.send('🤖 Bot de Oposiciones funcionando correctamente');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor corriendo en puerto ${PORT}`);
});

let usuarios = {};
let sesiones = {};

const temas = {
    '1': {
        nombre: 'Constitución Española',
        temario: 'La Constitución española: estructura y contenido. Derechos y deberes fundamentales.'
    },
    '16': {
        nombre: 'Sistema Público de Servicios Sociales',
        temario: 'El sistema público de protección de servicios sociales en el marco de las políticas de bienestar social.'
    },
    '21': {
        nombre: 'Ley de Dependencia',
        temario: 'La Ley 39/2006, de 14 de diciembre, de Promoción de la Autonomía Personal y Atención a las personas en situación de dependencia.'
    }
};

console.log('🤖 Bot iniciado correctamente');

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.first_name;
    
    usuarios[chatId] = {
        nombre: username,
        progreso: {},
        configuracion: { dificultad: 'alta' },
        fechaRegistro: new Date()
    };
    
    bot.sendMessage(chatId, `🎓 ¡Hola ${username}! Soy tu bot de oposiciones.

🚀 **Comandos:**
/rapido - 5 preguntas rápidas
/medio - 10 preguntas  
/tema16 - Servicios Sociales
/progreso - Ver estadísticas

¡Empezamos! 🚇`, {
        reply_markup: {
            keyboard: [
                ['🚇 /rapido', '🚌 /medio'],
                ['📚 /tema16', '📊 /progreso']
            ],
            resize_keyboard: true
        }
    });
});

bot.onText(/\/rapido/, async (msg) => {
    await iniciarSesion(msg.chat.id, '16', 5);
});

async function generarPreguntas(tema, cantidad) {
    const temaInfo = temas[tema] || { nombre: 'Servicios Sociales', temario: 'Contenido general' };
    
    const prompt = `Genera ${cantidad} preguntas tipo test sobre ${temaInfo.nombre} para oposiciones de trabajo social Madrid.

FORMATO JSON:
{
  "preguntas": [
    {
      "pregunta": "¿Cuál es el principio rector principal del sistema de servicios sociales según la Ley 12/2022?",
      "opciones": ["Universalidad", "Atención centrada en la persona", "Proximidad", "Eficiencia"],
      "correcta": 1,
      "explicacion": "La atención centrada en la persona es el principio nuclear que articula todo el sistema."
    }
  ]
}`;

    try {
        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "anthropic-version": "2023-06-01",
                "x-api-key": CLAUDE_API_KEY
            },
            body: JSON.stringify({
                model: "claude-3-sonnet-20240229",
                max_tokens: 3000,
                messages: [{ role: "user", content: prompt }]
            })
        });

        const data = await response.json();
        let responseText = data.content[0].text;
        responseText = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        
        const preguntasData = JSON.parse(responseText);
        return preguntasData.preguntas;
        
    } catch (error) {
        console.error('Error:', error);
        return [{
            pregunta: "¿Cuál es el principio rector principal según la Ley 12/2022 de Madrid?",
            opciones: ["Universalidad", "Atención centrada en la persona", "Proximidad", "Eficiencia"],
            correcta: 1,
            explicacion: "La atención centrada en la persona es el principio nuclear del sistema."
        }];
    }
}

async function iniciarSesion(chatId, tema, cantidad) {
    bot.sendMessage(chatId, '🧠 Generando preguntas con Claude IA...');
    
    const preguntas = await generarPreguntas(tema, cantidad);
    
    sesiones[chatId] = {
        preguntas: preguntas,
        actual: 0,
        aciertos: 0,
        fallos: 0
    };
    
    enviarPregunta(chatId);
}

function enviarPregunta(chatId) {
    const sesion = sesiones[chatId];
    const pregunta = sesion.preguntas[sesion.actual];
    
    const opciones = pregunta.opciones.map((op, i) => 
        [{text: `${String.fromCharCode(65 + i)}) ${op}`, callback_data: `resp_${i}`}]
    );
    
    bot.sendMessage(chatId, `❓ **Pregunta ${sesion.actual + 1}/${sesion.preguntas.length}**\n\n${pregunta.pregunta}`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: opciones }
    });
}

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const respuesta = parseInt(query.data.replace('resp_', ''));
    const sesion = sesiones[chatId];
    const pregunta = sesion.preguntas[sesion.actual];
    
    const esCorrecta = respuesta === pregunta.correcta;
    if (esCorrecta) sesion.aciertos++;
    else sesion.fallos++;
    
    const emoji = esCorrecta ? '✅' : '❌';
    const resultado = esCorrecta ? 'CORRECTO' : 'INCORRECTO';
    
    bot.editMessageText(`${emoji} **${resultado}**\n\n💡 ${pregunta.explicacion}`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
            inline_keyboard: [[{text: '➡️ Siguiente', callback_data: 'siguiente'}]]
        }
    });
});

bot.on('callback_query', (query) => {
    if (query.data === 'siguiente') {
        const chatId = query.message.chat.id;
        const sesion = sesiones[chatId];
        
        sesion.actual++;
        if (sesion.actual < sesion.preguntas.length) {
            bot.deleteMessage(chatId, query.message.message_id);
            enviarPregunta(chatId);
        } else {
            const porcentaje = Math.round((sesion.aciertos / sesion.preguntas.length) * 100);
            bot.editMessageText(`🎯 **COMPLETADO**\n\n✅ ${sesion.aciertos} aciertos\n❌ ${sesion.fallos} fallos\n📈 ${porcentaje}%`, {
                chat_id: chatId,
                message_id: query.message.message_id,
                parse_mode: 'Markdown'
            });
        }
    }
});
