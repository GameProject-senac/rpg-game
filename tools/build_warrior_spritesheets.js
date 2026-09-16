/**
 * tools/build_warrior_spritesheets.js
 * Utilitário determinístico para empacotar frames individuais de 'MAPA E PERSONAGENS/guerreiro'
 * em Spritesheets otimizados com zlib nativo (sem dependências externas) em 'assets/sprites/warrior/'.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        if (c & 1) c = 0xedb88320 ^ (c >>> 1);
        else c = c >>> 1;
    }
    crcTable[n] = c;
}

function calcCrc(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
    const len = data.length;
    const chunk = Buffer.alloc(12 + len);
    chunk.writeUInt32BE(len, 0);
    chunk.write(type, 4, 4, 'ascii');
    data.copy(chunk, 8);
    const crcBuf = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    chunk.writeUInt32BE(calcCrc(crcBuf), 8 + len);
    return chunk;
}

function paethPredictor(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function decodePngRgba(filePath) {
    const data = fs.readFileSync(filePath);
    let offset = 8;
    let width = 0, height = 0;
    const idatChunks = [];

    while (offset < data.length) {
        const length = data.readUInt32BE(offset);
        const type = data.toString('ascii', offset + 4, offset + 8);
        if (type === 'IHDR') {
            width = data.readUInt32BE(offset + 8);
            height = data.readUInt32BE(offset + 12);
        } else if (type === 'IDAT') {
            idatChunks.push(data.subarray(offset + 8, offset + 8 + length));
        } else if (type === 'IEND') {
            break;
        }
        offset += 12 + length;
    }

    const uncompressed = zlib.inflateSync(Buffer.concat(idatChunks));
    const rawRgba = Buffer.alloc(width * height * 4);
    const bpp = 4;
    const scanlineLen = width * bpp;
    const stride = 1 + scanlineLen;

    const prevScanline = Buffer.alloc(scanlineLen);
    const currScanline = Buffer.alloc(scanlineLen);

    for (let y = 0; y < height; y++) {
        const lineStart = y * stride;
        const filterType = uncompressed[lineStart];
        const lineData = uncompressed.subarray(lineStart + 1, lineStart + stride);

        for (let i = 0; i < scanlineLen; i++) {
            const x = lineData[i];
            const a = i >= bpp ? currScanline[i - bpp] : 0;
            const b = prevScanline[i];
            const c = i >= bpp ? prevScanline[i - bpp] : 0;

            let val = 0;
            switch (filterType) {
                case 0: val = x; break;
                case 1: val = (x + a) & 0xff; break;
                case 2: val = (x + b) & 0xff; break;
                case 3: val = (x + Math.floor((a + b) / 2)) & 0xff; break;
                case 4: val = (x + paethPredictor(a, b, c)) & 0xff; break;
                default: throw new Error('Tipo de filtro inválido: ' + filterType);
            }
            currScanline[i] = val;
        }

        currScanline.copy(rawRgba, y * scanlineLen);
        currScanline.copy(prevScanline);
    }

    return { width, height, rawRgba };
}

function encodePngRgba(width, height, rawRgba) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    const ihdrChunk = makeChunk('IHDR', ihdr);

    const scanlineLen = width * 4;
    const filtered = Buffer.alloc(height * (1 + scanlineLen));
    for (let y = 0; y < height; y++) {
        const destOffset = y * (1 + scanlineLen);
        filtered[destOffset] = 0;
        rawRgba.copy(filtered, destOffset + 1, y * scanlineLen, (y + 1) * scanlineLen);
    }

    const compressed = zlib.deflateSync(filtered, { level: 9 });
    const idatChunk = makeChunk('IDAT', compressed);
    const iendChunk = makeChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const sourceBase = path.join(__dirname, '..', 'MAPA E PERSONAGENS', 'guerreiro');
const outputDir = path.join(__dirname, '..', 'assets', 'sprites', 'warrior');

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

const animations = [
    { dir: 'Idle 1', out: 'idle.png' },
    { dir: 'Idle 2', out: 'idle2.png' },
    { dir: 'Run 1', out: 'run.png' },
    { dir: 'Run Skill', out: 'run_skill.png' },
    { dir: 'Attack 1', out: 'attack1.png' },
    { dir: 'Attack 2', out: 'attack2.png' },
    { dir: 'Crit 1', out: 'crit.png' },
    { dir: 'Spell Decisive Strike', out: 'spell_decisive.png' },
    { dir: 'Spell Demacian Justice', out: 'spell_demacian.png' },
    { dir: 'Spell Judgement', out: 'spell_judgement.png' },
    { dir: 'Taunt', out: 'taunt.png' },
    { dir: 'Dance Start', out: 'dance_start.png' },
    { dir: 'Dance Loop', out: 'dance_loop.png' }
];

console.log('Iniciando empacotamento das animações do Guerreiro...');

for (const anim of animations) {
    const animDir = path.join(sourceBase, anim.dir);
    if (!fs.existsSync(animDir)) {
        console.warn(`Diretório não encontrado: ${animDir}`);
        continue;
    }

    const files = fs.readdirSync(animDir)
        .filter(f => f.endsWith('.png') && !f.endsWith('.import'))
        .sort((a, b) => {
            const numA = parseInt(path.basename(a, '.png'), 10);
            const numB = parseInt(path.basename(b, '.png'), 10);
            return numA - numB;
        });

    if (files.length === 0) {
        console.warn(`Nenhum PNG encontrado em: ${animDir}`);
        continue;
    }

    console.log(`Processando ${anim.dir} (${files.length} frames)...`);

    const frames = files.map(f => decodePngRgba(path.join(animDir, f)));
    const frameW = frames[0].width;
    const frameH = frames[0].height;
    const totalW = frameW * frames.length;
    const totalH = frameH;

    const sheetBuffer = Buffer.alloc(totalW * totalH * 4);

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
        const frame = frames[fIdx];
        for (let y = 0; y < frameH; y++) {
            const srcStart = y * frameW * 4;
            const srcEnd = srcStart + frameW * 4;
            const destStart = (y * totalW + fIdx * frameW) * 4;
            frame.rawRgba.copy(sheetBuffer, destStart, srcStart, srcEnd);
        }
    }

    const pngBuffer = encodePngRgba(totalW, totalH, sheetBuffer);
    const outFile = path.join(outputDir, anim.out);
    fs.writeFileSync(outFile, pngBuffer);
    console.log(` -> Salvo: ${outFile} (${totalW}x${totalH}, ${(pngBuffer.length / 1024).toFixed(1)} KB)`);
}

console.log('Empacotamento concluído com sucesso!');
