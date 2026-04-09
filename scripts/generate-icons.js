/**
 * Westron Icon Generator
 * Generates all app icons from the Alt B design (Surface Clean):
 *   - #111111 background, white/grey 3D cross, #BEFF00 lime highlight
 *   - 820×820 artwork within 1024×1024 canvas (102px safe zone per side)
 *   - iOS/macOS squircle: cornerRadius = 183px (22.4% of 820)
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'src-tauri', 'icons');
const PUBLIC_DIR = path.join(ROOT, 'public');

// ─── SVG: 1024×1024 App Icon ─────────────────────────────────────────────────
// All path coordinates are pre-computed in canvas space (with 102px safe-zone offset).
// Cross geometry derived from westron.pen MCUaR paths, scaled from 300×300 → 820×820.

const ICON_SVG = `<svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
<defs>
  <!-- vFront / vRight share objectBoundingBox direction: top=light, bottom=dark -->
  <linearGradient id="gFront" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#FFFFFF"/>
    <stop offset="50%"  stop-color="#CCCCCC"/>
    <stop offset="100%" stop-color="#AAAAAA"/>
  </linearGradient>
  <linearGradient id="gRight" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#888888"/>
    <stop offset="100%" stop-color="#333333"/>
  </linearGradient>
  <!-- hFront: right=light → left=dark (rotation:270 in pen = rightward) -->
  <linearGradient id="gHFront" x1="1" y1="0" x2="0" y2="0">
    <stop offset="0%"   stop-color="#FFFFFF"/>
    <stop offset="50%"  stop-color="#CCCCCC"/>
    <stop offset="100%" stop-color="#AAAAAA"/>
  </linearGradient>
  <clipPath id="clip">
    <rect x="102" y="102" width="820" height="820" rx="183" ry="183"/>
  </clipPath>
</defs>

<!-- Dark background with iOS squircle -->
<rect x="102" y="102" width="820" height="820" rx="183" ry="183" fill="#111111"/>

<g clip-path="url(#clip)">
  <!-- vTop — dark isometric cap -->
  <path d="M475,351 L558,312 L599,291 L516,330 Z" fill="#2A2A2A"/>
  <!-- vRight — side face (grey gradient) -->
  <path d="M557,312 L598,291 L598,682 L557,703 Z" fill="url(#gRight)"/>
  <!-- vFront — front face (white gradient) -->
  <path d="M475,350 L558,311 L558,702 L475,741 Z" fill="url(#gFront)"/>
  <!-- hTop — dark isometric cap -->
  <path d="M312,480 L353,459 L712,394 L671,415 Z" fill="#2A2A2A"/>
  <!-- hRight — side face (grey gradient) -->
  <path d="M670,415 L711,394 L711,537 L670,558 Z" fill="url(#gRight)"/>
  <!-- hFront — front face (white→dark gradient) -->
  <path d="M312,480 L670,415 L670,559 L312,624 Z" fill="url(#gHFront)"/>
  <!-- Highlight — lime accent stripe across horizontal bar -->
  <path d="M315,487 L670,422 L670,445 L315,510 Z" fill="#BEFF00" opacity="0.30"/>
</g>
</svg>`;

// ─── SVG: Logo Mark (transparent bg, for /public/logo-mark.png) ───────────────
// Cross only, no background. Sized to 320×361 matching existing Navbar usage.
// Coordinates scaled from canvas → 320×361: offset (-312,-291), scale 0.802.

const LOGO_MARK_SVG = `<svg width="320" height="361" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="lgFront" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#FFFFFF"/>
    <stop offset="50%"  stop-color="#CCCCCC"/>
    <stop offset="100%" stop-color="#AAAAAA"/>
  </linearGradient>
  <linearGradient id="lgRight" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#888888"/>
    <stop offset="100%" stop-color="#333333"/>
  </linearGradient>
  <linearGradient id="lgHFront" x1="1" y1="0" x2="0" y2="0">
    <stop offset="0%"   stop-color="#FFFFFF"/>
    <stop offset="50%"  stop-color="#CCCCCC"/>
    <stop offset="100%" stop-color="#AAAAAA"/>
  </linearGradient>
</defs>
<!-- vTop -->
<path d="M131,48 L197,17 L230,0 L164,31 Z" fill="#2A2A2A"/>
<!-- vRight -->
<path d="M197,17 L229,0 L229,314 L197,330 Z" fill="url(#lgRight)"/>
<!-- vFront -->
<path d="M131,47 L197,16 L197,330 L131,361 Z" fill="url(#lgFront)"/>
<!-- hTop -->
<path d="M0,152 L33,135 L321,83 L288,99 Z" fill="#2A2A2A"/>
<!-- hRight -->
<path d="M287,99 L320,83 L320,197 L287,214 Z" fill="url(#lgRight)"/>
<!-- hFront -->
<path d="M0,152 L287,99 L287,215 L0,267 Z" fill="url(#lgHFront)"/>
<!-- Lime highlight -->
<path d="M2,155 L287,103 L287,120 L2,172 Z" fill="#BEFF00" opacity="0.30"/>
</svg>`;

// ─── Generate ─────────────────────────────────────────────────────────────────

const ICON_SIZES = [
  { file: 'icon.png',          size: 1024 },
  { file: '128x128@2x.png',    size: 256  },
  { file: '128x128.png',       size: 128  },
  { file: '32x32.png',         size: 32   },
  { file: 'Square310x310Logo.png', size: 310 },
  { file: 'Square284x284Logo.png', size: 284 },
  { file: 'Square150x150Logo.png', size: 150 },
  { file: 'Square142x142Logo.png', size: 142 },
  { file: 'Square107x107Logo.png', size: 107 },
  { file: 'Square89x89Logo.png',   size: 89  },
  { file: 'Square71x71Logo.png',   size: 71  },
  { file: 'Square44x44Logo.png',   size: 44  },
  { file: 'Square30x30Logo.png',   size: 30  },
  { file: 'StoreLogo.png',         size: 50  },
];

// ─── SVG: Full Brand Logo (cross + WESTRON text) for /public/logo.png ─────────
const LOGO_SVG = `<svg width="960" height="400" xmlns="http://www.w3.org/2000/svg">
<rect width="960" height="400" fill="#111111"/>
<defs>
  <linearGradient id="blgFront" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#FFFFFF"/>
    <stop offset="50%"  stop-color="#CCCCCC"/>
    <stop offset="100%" stop-color="#AAAAAA"/>
  </linearGradient>
  <linearGradient id="blgRight" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%"   stop-color="#888888"/>
    <stop offset="100%" stop-color="#333333"/>
  </linearGradient>
  <linearGradient id="blgHFront" x1="1" y1="0" x2="0" y2="0">
    <stop offset="0%"   stop-color="#FFFFFF"/>
    <stop offset="50%"  stop-color="#CCCCCC"/>
    <stop offset="100%" stop-color="#AAAAAA"/>
  </linearGradient>
</defs>
<!-- Cross mark, centered vertically, left-aligned at x=80 -->
<!-- Scaled from logo-mark paths (320×361 → ~180×203 at 0.5625 scale, centered in 400h) -->
<g transform="translate(80, 99) scale(0.5625)">
  <path d="M131,48 L197,17 L230,0 L164,31 Z" fill="#2A2A2A"/>
  <path d="M197,17 L229,0 L229,314 L197,330 Z" fill="url(#blgRight)"/>
  <path d="M131,47 L197,16 L197,330 L131,361 Z" fill="url(#blgFront)"/>
  <path d="M0,152 L33,135 L321,83 L288,99 Z" fill="#2A2A2A"/>
  <path d="M287,99 L320,83 L320,197 L287,214 Z" fill="url(#blgRight)"/>
  <path d="M0,152 L287,99 L287,215 L0,267 Z" fill="url(#blgHFront)"/>
  <path d="M2,155 L287,103 L287,120 L2,172 Z" fill="#BEFF00" opacity="0.30"/>
</g>
<!-- WESTRON wordmark -->
<text x="295" y="232"
  font-family="'Helvetica Neue', Helvetica, Arial, sans-serif"
  font-size="88"
  font-weight="300"
  letter-spacing="14"
  fill="#FFFFFF">WESTRON</text>
</svg>`;

// Build a minimal ICO file from an array of PNG buffers + their sizes
function buildIco(pngBuffers, sizes) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const dirSize = count * dirEntrySize;
  const dataOffset = headerSize + dirSize;

  let totalSize = dataOffset;
  pngBuffers.forEach(b => { totalSize += b.length; });

  const buf = Buffer.alloc(totalSize);
  // ICO header
  buf.writeUInt16LE(0, 0);      // reserved
  buf.writeUInt16LE(1, 2);      // type: 1 = ICO
  buf.writeUInt16LE(count, 4);  // image count

  let dataPos = dataOffset;
  pngBuffers.forEach((png, i) => {
    const s = sizes[i];
    const offset = headerSize + i * dirEntrySize;
    buf.writeUInt8(s >= 256 ? 0 : s, offset);      // width (0 = 256)
    buf.writeUInt8(s >= 256 ? 0 : s, offset + 1);  // height
    buf.writeUInt8(0, offset + 2);   // color count
    buf.writeUInt8(0, offset + 3);   // reserved
    buf.writeUInt16LE(1, offset + 4); // planes
    buf.writeUInt16LE(32, offset + 6); // bit count
    buf.writeUInt32LE(png.length, offset + 8);  // data size
    buf.writeUInt32LE(dataPos, offset + 12);    // data offset
    png.copy(buf, dataPos);
    dataPos += png.length;
  });
  return buf;
}

async function run() {
  fs.mkdirSync(ICONS_DIR, { recursive: true });

  const iconBuf = Buffer.from(ICON_SVG);

  // PNG sizes
  for (const { file, size } of ICON_SIZES) {
    await sharp(iconBuf)
      .resize(size, size)
      .png()
      .toFile(path.join(ICONS_DIR, file));
    console.log(`✓ ${file} (${size}×${size})`);
  }

  // icon.ico (Windows — 16, 32, 48, 256)
  const icoSizes = [256, 48, 32, 16];
  const icoBuffers = await Promise.all(
    icoSizes.map(s => sharp(iconBuf).resize(s, s).png().toBuffer())
  );
  // Use the 256px PNG as .ico fallback (sharp doesn't write multi-size .ico natively)
  await sharp(iconBuf).resize(256, 256).png().toFile(path.join(ICONS_DIR, 'icon.ico'));
  console.log('✓ icon.ico (256×256 fallback)');

  // icon.icns (macOS — via iconutil)
  const iconsetDir = path.join(ICONS_DIR, 'icon.iconset');
  fs.mkdirSync(iconsetDir, { recursive: true });
  const icnsSizes = [
    { file: 'icon_16x16.png',      size: 16  },
    { file: 'icon_16x16@2x.png',   size: 32  },
    { file: 'icon_32x32.png',      size: 32  },
    { file: 'icon_32x32@2x.png',   size: 64  },
    { file: 'icon_64x64.png',      size: 64  },
    { file: 'icon_64x64@2x.png',   size: 128 },
    { file: 'icon_128x128.png',    size: 128 },
    { file: 'icon_128x128@2x.png', size: 256 },
    { file: 'icon_256x256.png',    size: 256 },
    { file: 'icon_256x256@2x.png', size: 512 },
    { file: 'icon_512x512.png',    size: 512 },
    { file: 'icon_512x512@2x.png', size: 1024},
  ];
  for (const { file, size } of icnsSizes) {
    await sharp(iconBuf).resize(size, size).png().toFile(path.join(iconsetDir, file));
  }
  execSync(`iconutil -c icns "${iconsetDir}" -o "${path.join(ICONS_DIR, 'icon.icns')}"`);
  fs.rmSync(iconsetDir, { recursive: true });
  console.log('✓ icon.icns (macOS multi-size)');

  // Logo mark for Navbar
  await sharp(Buffer.from(LOGO_MARK_SVG))
    .resize(320, 361)
    .png()
    .toFile(path.join(PUBLIC_DIR, 'logo-mark.png'));
  console.log('✓ logo-mark.png (320×361, transparent)');

  // icon-source.png (master source reference)
  await sharp(iconBuf)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(PUBLIC_DIR, 'icon-source.png'));
  console.log('✓ icon-source.png (1024×1024)');

  // logo.png — full horizontal brand logo
  await sharp(Buffer.from(LOGO_SVG))
    .resize(960, 400)
    .png()
    .toFile(path.join(PUBLIC_DIR, 'logo.png'));
  console.log('✓ logo.png (960×400)');

  // favicon.ico — multi-size ICO for browser tab
  // Build a minimal ICO container with 32×32 and 16×16 PNG images
  const fav32 = await sharp(iconBuf).resize(32, 32).png().toBuffer();
  const fav16 = await sharp(iconBuf).resize(16, 16).png().toBuffer();
  const ico = buildIco([fav32, fav16], [32, 16]);
  fs.writeFileSync(path.join(ROOT, 'src', 'app', 'favicon.ico'), ico);
  console.log('✓ favicon.ico (32×32 + 16×16)');

  console.log('\nAll icons generated successfully.');
}

run().catch(err => { console.error(err); process.exit(1); });
