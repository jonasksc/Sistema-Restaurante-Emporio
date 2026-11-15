'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Bloqueio por pasta de dados: impede dois processos desta versão de sobrescreverem o mesmo SQLite.
function acquireInstanceLock(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, '.emporio-instancia.lock');
  const secret = crypto.randomBytes(16).toString('hex');
  const mine = { pid: process.pid, startedAt: Date.now(), secret };
  const isAlive = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try { process.kill(pid, 0); return true; }
    catch (err) { return err.code === 'EPERM' ? true : err.code === 'ESRCH' ? false : null; }
  };
  let acquired = false;
  for (let attempt = 0; attempt < 3 && !acquired; attempt++) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600);
      fs.writeFileSync(fd, JSON.stringify(mine));
      fs.fsyncSync(fd);
      acquired = true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      // Nunca remover um bloqueio se houver um processo possivelmente ativo.
      let stored;
      try { stored = JSON.parse(fs.readFileSync(lockPath, 'utf8')); }
      catch (err) { throw new Error('Arquivo de bloqueio inválido: ' + lockPath + '. Verifique se o sistema está fechado antes de removê-lo.'); }
      const alive = isAlive(stored.pid);
      if (alive !== false) throw new Error('O Empório já está em execução usando esta pasta de dados (PID ' + stored.pid + '). Feche a janela anterior antes de abrir outra.');
      try { fs.unlinkSync(lockPath); } catch (err) { throw new Error('Não foi possível remover bloqueio antigo: ' + err.message); }
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
  }
  if (!acquired) throw new Error('Não foi possível obter acesso exclusivo ao banco de dados.');
  let released = false;
  return () => {
    if (released) return;
    released = true;
    try {
      const stored = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (stored.secret === secret && stored.pid === process.pid) fs.unlinkSync(lockPath);
    } catch (_) { /* O lock pode já ter sido removido; nunca apagar outro lock. */ }
  };
}
module.exports = { acquireInstanceLock };
