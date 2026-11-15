'use strict';
const fs = require('fs');
const crypto = require('crypto');

/**
 * Salva um arquivo por substituição atômica no mesmo diretório.
 * Caso o arquivo temporário não possa ser renomeado, o destino permanece intacto.
 * Não existe fallback de escrita direta: isso protege o banco contra truncamento.
 */
function writeAtomic(destination, data, io = fs) {
  const temp = `${destination}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  let created = false;
  try {
    const fd = io.openSync(temp, 'wx', 0o600);
    created = true;
    try {
      io.writeFileSync(fd, data);
      io.fsyncSync(fd);
    } finally {
      io.closeSync(fd);
    }
    io.renameSync(temp, destination);
  } catch (error) {
    if (created) {
      try { io.unlinkSync(temp); } catch (_) { /* a tentativa de limpeza não deve esconder o erro original */ }
    }
    throw error;
  }
}

module.exports = { writeAtomic };
