/**
 * zip.js — Escreve um .zip sem depender de biblioteca
 *
 * O projeto roda do disco e não tem dependência; este arquivo existe para que a
 * reescrita do projeto inteiro possa sair num único download. Usa o método
 * "armazenado" (sem compressão), que é o suficiente para texto e mantém o
 * escritor em algumas dezenas de linhas.
 */

'use strict';

/** CRC-32, o que o formato exige por arquivo. */
const CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABELA[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Monta um Blob .zip.
 * @param {Array<{path: string, text: string}>} arquivos
 */
function buildZip(arquivos) {
  const cod = new TextEncoder();
  const partes = [], central = [];
  let desloc = 0;

  const u16 = v => [v & 0xFF, (v >>> 8) & 0xFF];
  const u32 = v => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

  for (const arq of arquivos) {
    const nome = cod.encode(arq.path.replace(/\\/g, '/'));
    const dados = cod.encode(arq.text);
    const crc = crc32(dados);

    const local = [
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),                       // hora e data: zeradas de propósito
      ...u32(crc), ...u32(dados.length), ...u32(dados.length),
      ...u16(nome.length), ...u16(0),
    ];
    partes.push(new Uint8Array(local), nome, dados);

    central.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0),
      ...u32(crc), ...u32(dados.length), ...u32(dados.length),
      ...u16(nome.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(desloc),
    ]), nome);

    desloc += local.length + nome.length + dados.length;
  }

  const inicioCentral = desloc;
  let tamCentral = 0;
  for (const p of central) tamCentral += p.length;

  const fim = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(arquivos.length), ...u16(arquivos.length),
    ...u32(tamCentral), ...u32(inicioCentral), ...u16(0),
  ]);

  return new Blob([...partes, ...central, fim], { type: 'application/zip' });
}
