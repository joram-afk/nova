// Minimal 192x192 and 512x512 PNG generation using raw bytes
import fs from 'fs';
import zlib from 'zlib';

function writePNG(filename, width, height, r, g, b) {
  // PNG signature
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type (truecolor)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrData = Buffer.concat([Buffer.from('IHDR'), ihdr]);
  const ihdrCrc = zlib.crc32(ihdrData);
  
  // IDAT chunk - simple scanlines with filter type 0
  const scanline = Buffer.alloc(1 + width * 3);
  scanline[0] = 0; // filter type 0 (none)
  for (let x = 0; x < width; x++) {
    scanline[1 + x*3] = r;
    scanline[1 + x*3 + 1] = g;
    scanline[1 + x*3 + 2] = b;
  }
  const idatData = Buffer.concat([Buffer.from('IDAT'), zlib.deflateRawSync(scanline)]);
  const idatCrc = zlib.crc32(idatData);
  
  // IEND chunk
  const iendData = Buffer.from('IEND');
  const iendCrc = zlib.crc32(iendData);
  
  // Helper to write chunk: length (4 bytes) + data + crc (4 bytes)
  function writeChunk(name, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([Buffer.from(name), data])));
    return Buffer.concat([len, Buffer.from(name), data, crc]);
  }
  
  // Write PNG
  const chunks = [];
  chunks.push(sig);
  chunks.push(writeChunk('IHDR', ihdr));
  chunks.push(writeChunk('IDAT', zlib.deflateRawSync(scanline)));
  chunks.push(writeChunk('IEND', Buffer.alloc(0)));
  
  fs.writeFileSync(filename, Buffer.concat(chunks));
  console.log(`Created ${filename}`);
}

writePNG('public/icon-192.png', 192, 192, 11, 13, 18);  // #0b0d12
writePNG('public/icon-512.png', 512, 512, 11, 13, 18);  // #0b0d12
