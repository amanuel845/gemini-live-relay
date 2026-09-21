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

const wss = new WebSocketServer({ server, path: '/' });

wss.on('connection', async (clientWs) => {
  console.log('--- browser connected ---');
  let session;

  try {
    session = await ai.live.connect({
      model: 'gemini-3.1-flash-live-preview',
      config: {
        responseModalities: ['AUDIO'],
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => console.log('   [gemini] onopen'),
        onmessage: (msg) => {
          const sc = msg?.serverContent;
          const text = sc?.outputTranscription?.text || '';
          if (text) clientWs.send(JSON.stringify({ text }));
          const parts = sc?.modelTurn?.parts || [];
          for (const p of parts) {
            if (p.inlineData?.data) clientWs.send(JSON.stringify({ audio: p.inlineData.data }));
          }
          if (sc?.turnComplete) clientWs.send(JSON.stringify({ turnComplete: true }));
          if (msg?.setupComplete) clientWs.send(JSON.stringify({ setupComplete: true }));
        },
        onerror: (e) => console.error('   [gemini] onerror:', e?.message || e),
        onclose: (e) => console.log('   [gemini] onclose:', e?.reason || e),
      },
    });
    console.log('✅ ai.live.connect returned');
  } catch (err) {
    console.error('❌ ai.live.connect threw:', err);
    try { clientWs.send(JSON.stringify({ type: 'error', message: String(err?.message || err) })); } catch (_) {}
    clientWs.close();
    return;
  }

  clientWs.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.text) await session.sendRealtimeInput({ text: msg.text });
    } catch (e) { console.error('❌ send error:', e); }
  });

  clientWs.on('close', () => { try { session.close(); } catch (_) {} });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log('🚀 Relay listening on :' + PORT));
