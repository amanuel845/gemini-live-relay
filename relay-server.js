// relay-server.js
import { WebSocketServer } from 'ws';
import { GoogleGenAI } from '@google/genai';
import http from 'http';

// 1. Create a basic HTTP server for health checks (Render/Railway need this)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Gemini Live Relay is running.\n');
});

// 2. Attach the WebSocket server to it
const wss = new WebSocketServer({ server });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

wss.on('connection', async (clientWs) => {
    console.log('Client connected');

    try {
        // Connect to Gemini Live API
        const session = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
                responseModalities: ['TEXT', 'AUDIO'],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
            },
            callbacks: {
                onmessage: (message) => {
                    // Forward Gemini messages to the client
                    clientWs.send(JSON.stringify(message));
                },
                onerror: (error) => console.error('Gemini Live error:', error),
                onclose: () => clientWs.close(),
            },
        });

        // Forward client messages to Gemini
        clientWs.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                await session.sendClientContent(message);
            } catch (e) { 
                console.error('Error forwarding message:', e); 
            }
        });

        clientWs.on('close', () => {
            console.log('Client disconnected');
            session.close();
        });

    } catch (error) {
        console.error('Failed to connect to Gemini Live:', error);
        clientWs.close();
    }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Relay server listening on port ${PORT}`);
});
