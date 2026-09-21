import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import http from 'http';

process.on('unhandledRejection', (r) => console.error('❌ UNHANDLED REJECTION:', r));
process.on('uncaughtException',  (e) => console.error('❌ UNCAUGHT EXCEPTION:', e));

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Relay alive\n');
});

console.log('API key present:', !!process.env.GEMINI_API_KEY);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

/* =====================================================================
 * PATH  /  →  Live chat (Gemini Live API)
 * ===================================================================== */
const liveWss = new WebSocketServer({ server, path: '/' });

liveWss.on('connection', async (clientWs) => {
  console.log('--- [live] browser connected ---');
  let session;

  try {
    session = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: ['AUDIO'],
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => console.log('   [live] onopen'),
        onmessage: (msg) => {
          const sc = msg?.serverContent;

          const text = sc?.outputTranscription?.text || '';
          if (text) {
            console.log('   [live] text chunk:', JSON.stringify(text));
            clientWs.send(JSON.stringify({ text }));
          }

          const parts = sc?.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: p.inlineData.data }));
            }
          }

          if (sc?.turnComplete) {
            console.log('   [live] turnComplete');
            clientWs.send(JSON.stringify({ turnComplete: true }));
          }

          if (msg?.setupComplete) {
            console.log('   [live] setupComplete');
            clientWs.send(JSON.stringify({ setupComplete: true }));
          }
        },
        onerror: (e) => console.error('   [live] onerror:', e?.message || e),
        onclose: (e) => console.log('   [live] onclose:', e?.reason || e),
      },
    });
    console.log('✅ [live] ai.live.connect returned');
  } catch (err) {
    console.error('❌ [live] connect threw:', err);
    try { clientWs.send(JSON.stringify({ type: 'error', message: String(err?.message || err) })); } catch (_) {}
    clientWs.close();
    return;
  }

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.text) {
        console.log('--- [live] browser sent:', msg.text);
        await session.sendRealtimeInput({ text: msg.text });
        console.log('✅ [live] sent to gemini');
      }
    } catch (e) {
      console.error('❌ [live] send error:', e);
    }
  });

  clientWs.on('close', () => {
    console.log('--- [live] browser disconnected ---');
    try { session.close(); } catch (_) {}
  });
});

/* =====================================================================
 * PATH  /music  →  Live Music (Lyria RealTime)
 * ===================================================================== */
const musicWss = new WebSocketServer({ server, path: '/music' });

musicWss.on('connection', async (clientWs) => {
  console.log('--- [music] browser connected ---');
  let session;

  const sendToClient = (obj) => {
    try { clientWs.send(JSON.stringify(obj)); } catch (_) {}
  };

  try {
    session = await ai.live.music.connect({
      model: 'models/lyria-realtime-exp',
      callbacks: {
        onopen: () => console.log('   [music] onopen'),
        onmessage: (message) => {
          if (message?.serverContent?.audioChunks) {
            for (const chunk of message.serverContent.audioChunks) {
              if (chunk?.data) sendToClient({ type: 'audio', audio: chunk.data });
            }
          } else {
            sendToClient({ type: 'server', payload: message });
          }
        },
        onerror: (e) => {
          console.error('   [music] onerror:', e?.message || e);
          sendToClient({ type: 'error', message: String(e?.message || e) });
        },
        onclose: (e) => {
          console.log('   [music] onclose:', e?.reason || e);
          sendToClient({ type: 'closed' });
          clientWs.close();
        },
      },
    });
    console.log('✅ [music] ai.live.music.connect returned');
  } catch (err) {
    console.error('❌ [music] connect threw:', err);
    sendToClient({ type: 'error', message: String(err?.message || err) });
    clientWs.close();
    return;
  }

  sendToClient({ type: 'ready' });

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.action === 'prompts' && Array.isArray(msg.prompts)) {
        await session.setWeightedPrompts({
          weightedPrompts: msg.prompts.map((p) => ({
            text: p.text,
            weight: typeof p.weight === 'number' ? p.weight : 1.0,
          })),
        });
        sendToClient({ type: 'ack', action: 'prompts' });
      }
      else if (msg.action === 'config') {
        await session.setMusicGenerationConfig({
          musicGenerationConfig: msg.config || {},
        });
        sendToClient({ type: 'ack', action: 'config' });
      }
      else if (msg.action === 'play')  { await session.play();  sendToClient({ type: 'ack', action: 'play' }); }
      else if (msg.action === 'pause') { await session.pause(); sendToClient({ type: 'ack', action: 'pause' }); }
      else if (msg.action === 'stop')  { await session.stop();  sendToClient({ type: 'ack', action: 'stop' }); }
      else if (msg.action === 'reset') { await session.resetContext(); sendToClient({ type: 'ack', action: 'reset' }); }
    } catch (e) {
      console.error('❌ [music] forward error:', e);
      sendToClient({ type: 'error', message: e.message });
    }
  });

  clientWs.on('close', () => {
    console.log('--- [music] browser disconnected ---');
    try { session.close(); } catch (_) {}
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('🚀 Relay listening on :' + PORT + '  (live: /  music: /music)'));
