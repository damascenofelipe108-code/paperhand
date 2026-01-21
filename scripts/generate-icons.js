const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SVG_PATH = path.join(__dirname, '..', 'app', 'frontend', 'public', 'icon.svg');
const OUTPUT_DIR = path.join(__dirname, '..', 'app', 'frontend', 'public');

async function generateIcons() {
  console.log('Gerando icones...');

  const svgBuffer = fs.readFileSync(SVG_PATH);

  // Gera PNG 256x256
  const pngPath = path.join(OUTPUT_DIR, 'icon.png');
  await sharp(svgBuffer)
    .resize(256, 256)
    .png()
    .toFile(pngPath);
  console.log('Criado:', pngPath);

  // Gera PNG 512x512 para macOS
  const png512Path = path.join(OUTPUT_DIR, 'icon-512.png');
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(png512Path);
  console.log('Criado:', png512Path);

  // Para ICO, usamos to-ico
  const toIco = require('to-ico');
  const icoPath = path.join(OUTPUT_DIR, 'icon.ico');

  // to-ico aceita array de buffers PNG
  const pngBuffer = fs.readFileSync(pngPath);
  const icoBuffer = await toIco([pngBuffer]);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('Criado:', icoPath);

  console.log('Icones gerados com sucesso!');
}

generateIcons().catch(err => {
  console.error('Erro:', err);
  process.exit(1);
});
