#!/usr/bin/env python3
"""Giọng đọc miễn phí (Microsoft Edge Neural, cùng tên giọng Azure) + mốc thời gian từng từ cho phụ đề.
Dùng: python tts.py jobs.json   (jobs.json = [{"id","text","voice","rate","out"}])  → ghi <out>.mp3 và <out>.words.json
"""
import asyncio, json, os, ssl, sys
import edge_tts
import edge_tts.communicate as cm

if os.environ.get('TTS_CAFILE'):
    cm._SSL_CTX = ssl.create_default_context(cafile=os.environ['TTS_CAFILE'])

async def one(job, sem):
    async with sem:
        for attempt in range(4):
            try:
                c = edge_tts.Communicate(job['text'], job.get('voice') or 'en-US-AndrewMultilingualNeural',
                                         rate=job.get('rate', '+0%'), boundary='WordBoundary')
                audio = bytearray(); words = []
                async for ch in c.stream():
                    if ch['type'] == 'audio':
                        audio.extend(ch['data'])
                    elif ch['type'] == 'WordBoundary':
                        words.append({'t': ch['offset'] / 1e7, 'd': ch['duration'] / 1e7, 'w': ch['text']})
                if not audio:
                    raise RuntimeError('no audio')
                with open(job['out'] + '.mp3', 'wb') as f:
                    f.write(audio)
                with open(job['out'] + '.words.json', 'w', encoding='utf-8') as f:
                    json.dump(words, f, ensure_ascii=False)
                return
            except Exception as e:  # mạng chập chờn → thử lại
                if attempt == 3:
                    raise
                await asyncio.sleep(2 + attempt * 3)

async def main():
    jobs = json.load(open(sys.argv[1], encoding='utf-8'))
    sem = asyncio.Semaphore(4)
    await asyncio.gather(*(one(j, sem) for j in jobs))

asyncio.run(main())
