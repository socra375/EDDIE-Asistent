// Packs extension/ into public/eddie-extension.zip, the file Eddie's hub offers
// for download ("Descargar la extensión"). Runs before every build, with no
// tools beyond Node: a small ZIP writer (deflate), always the same bytes for the
// same files so a build doesn't change what didn't change.
//
// The files sit at the root of the zip, with no folder around them: extractors
// (Chromebook's Files app, Windows, macOS) wrap them in a folder named after the
// zip, and Chrome's "Cargar descomprimida" needs the folder that holds
// manifest.json itself. A folder inside the zip made two nested folders, and the
// outer one has no manifest ("Falta el archivo de manifiesto").
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(root, 'extension');
const TARGET = join(root, 'public', 'eddie-extension.zip');
// 2026-01-01 00:00:00 in DOS date/time, so the zip is reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function listFiles(dir) {
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      return statSync(full).isDirectory() ? listFiles(full) : [full];
    });
}

// files: [{ name, data }] → a zip as a Buffer
export function zip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // names are UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, packed);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // made by
    entry.writeUInt16LE(20, 6); // needed
    entry.writeUInt16LE(0x0800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); // regular file, rw-r--r--
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

export function buildExtensionZip() {
  const files = listFiles(SOURCE).map((full) => ({ name: relative(SOURCE, full).split(sep).join('/'), data: readFileSync(full) }));
  if (!files.some((f) => f.name === 'manifest.json')) throw new Error('extension/manifest.json no existe.');
  mkdirSync(dirname(TARGET), { recursive: true });
  const data = zip(files);
  writeFileSync(TARGET, data);
  return { path: TARGET, files: files.length, bytes: data.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, bytes } = buildExtensionZip();
  console.log(`extension: ${files} archivos, ${bytes} bytes → public/eddie-extension.zip`);
}
