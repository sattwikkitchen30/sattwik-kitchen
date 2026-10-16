const zlib = require('zlib');

function unfilterPng(buf) {
  let offset = 8;
  const idatChunks = [];
  let width, height;
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') {
      width = buf.readUInt32BE(offset + 8);
      height = buf.readUInt32BE(offset + 12);
    } else if (type === 'IDAT') idatChunks.push(buf.subarray(offset + 8, offset + 8 + len));
    offset += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = 3;
  const stride = 1 + width * bpp;
  const data = Buffer.alloc(width * height * bpp);

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a; if (pb <= pc) return b; return c;
  }

  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    const curr = y * width * bpp;
    const prev = y > 0 ? (y - 1) * width * bpp : null;
    for (let x = 0; x < width * bpp; x++) {
      const orig = raw[y * stride + 1 + x];
      const left = x >= bpp ? data[curr + x - bpp] : 0;
      const up = y > 0 ? data[prev + x] : 0;
      const upLeft = (y > 0 && x >= bpp) ? data[prev + x - bpp] : 0;
      let val = 0;
      if (filter === 0) val = orig;
      else if (filter === 1) val = (orig + left) & 0xff;
      else if (filter === 2) val = (orig + up) & 0xff;
      else if (filter === 3) val = (orig + Math.floor((left + up) / 2)) & 0xff;
      else if (filter === 4) val = (orig + paeth(left, up, upLeft)) & 0xff;
      data[curr + x] = val;
    }
  }
  return { width, height, data };
}

async function analyze(url, name, threshold = 240) {
  try {
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    const { width, height, data } = unfilterPng(buf);

    function getPx(x, y) {
      const idx = (y * width + x) * 3;
      return [data[idx], data[idx + 1], data[idx + 2]];
    }

    let minX = width, maxX = 0, minY = height, maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = getPx(x, y);
        if (r < threshold || g < threshold || b < threshold) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    const subjectW = maxX - minX;
    const subjectH = maxY - minY;
    const pctW = ((subjectW / width) * 100).toFixed(1);
    const pctH = ((subjectH / height) * 100).toFixed(1);
    const aspectRatio = (width / height).toFixed(2);
    const subjectRatio = (subjectW / subjectH).toFixed(2);

    console.log(`${name}: ${width}x${height} (${aspectRatio}) | subject: ${subjectW}x${subjectH} (${subjectRatio}) = ${pctW}%w ${pctH}%h | pad L:${minX} R:${width-maxX} T:${minY} B:${height-maxY}`);
  } catch (e) {
    console.log(`${name}: ERROR - ${e.message}`);
  }
}

const images = [
  ['Carrot Halwa (ref)', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790746929/8AF2166F-3CC0-41CF-89C1-E55E520AAC50.png'],
  ['Bobbatlu', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790828003/IMG_4088.png'],
  ['Gulab Jamoon', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790827976/IMG_4084.png'],
  ['Double Ka Meeta', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790747220/double_ka_meeta.png'],
  ['DryFruit Burfi', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790827939/IMG_4086.png'],
  ['Arabian Delight', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790828006/IMG_4087.png'],
  ['Kaddu Kheer', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790747027/E66D21AC-7940-4920-B7F4-36175B81419E.png'],
  ['Kesari Bath', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790827913/IMG_4085.png'],
  ['Rabdi', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790828115/IMG_4083.png'],
  ['Gobi-65', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790830354/E4E26A09-188B-4DFE-9062-D3E5D8601778.png'],
  ['Mirchi Bajji', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790830348/A061BF68-BF0D-427A-A7A6-6FA30AA9D711.png'],
  ['Aloo Bonda', 'https://res.cloudinary.com/tjtump1b/image/upload/v1790829383/A09E158A-7083-424D-AF74-678560526BC5.png'],
];

Promise.all(images.map(([name, url]) => analyze(url, name)));
