// Sistema do Empório Cachoeira - servidor local com banco SQLite (arquivo dados/restaurante.db)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { exec } = require('child_process');
const initSqlJs = require('sql.js');
const PORT = process.env.PORT || 3000;
const BASE = process.pkg ? path.dirname(process.execPath) : __dirname; // pasta onde ficam os dados
const DIR = path.join(BASE, 'dados'), DB_FILE = path.join(DIR, 'restaurante.db'), BK = path.join(DIR, 'backups');
fs.mkdirSync(BK, { recursive: true });
let db, lastBk = 0;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS estado (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vendas (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, mesa TEXT, pagamento TEXT, total REAL NOT NULL);
CREATE TABLE IF NOT EXISTS venda_itens (id INTEGER PRIMARY KEY AUTOINCREMENT, venda_id INTEGER NOT NULL, produto TEXT NOT NULL, qtd INTEGER NOT NULL, preco REAL NOT NULL);
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vendas_t ON vendas(t);
CREATE INDEX IF NOT EXISTS idx_itens_venda ON venda_itens(venda_id);`;

const hoje = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function all(sql, p = []) { const st = db.prepare(sql); st.bind(p); const r = []; while (st.step()) r.push(st.getAsObject()); st.free(); return r; }

function gravar(buf) { // grava o banco; se o arquivo temporário for bloqueado (pen drive, antivírus), tenta gravar direto
  try { fs.writeFileSync(DB_FILE + '.tmp', buf); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
  catch (e) { try { fs.unlinkSync(DB_FILE + '.tmp'); } catch (_) {} fs.writeFileSync(DB_FILE, buf); }
}

function persist() { // grava o banco no disco e mantém uma cópia diária (atualizada a cada 5 min)
  const buf = Buffer.from(db.export());
  gravar(buf);
  if (Date.now() - lastBk > 300000) {
    lastBk = Date.now();
    try {
      fs.writeFileSync(path.join(BK, 'restaurante-' + hoje() + '.db'), buf);
      const l = fs.readdirSync(BK).filter(x => x.endsWith('.db')).sort();
      while (l.length > 60) fs.unlinkSync(path.join(BK, l.shift()));
    } catch (e) { console.error('Aviso: não foi possível gravar a cópia diária:', e.message); }
  }
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (res, c, o) => { res.writeHead(c, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };
const body = req => new Promise((ok, no) => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) { no(new Error('Dados muito grandes')); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch (e) { no(e); } }); });

function listarVendas(de, ate) { // de/ate (opcionais): filtra por período, para não carregar todo o histórico
  const w = [], p = [];
  if (de !== null) { w.push('t>=?'); p.push(de); }
  if (ate !== null) { w.push('t<?'); p.push(ate); }
  const cond = w.length ? ' WHERE ' + w.join(' AND ') : '';
  const itens = {};
  all('SELECT * FROM venda_itens WHERE venda_id IN (SELECT id FROM vendas' + cond + ') ORDER BY id', p).forEach(i => (itens[i.venda_id] = itens[i.venda_id] || []).push({ n: i.produto, q: i.qtd, p: i.preco }));
  return all('SELECT * FROM vendas' + cond + ' ORDER BY t', p).map(v => ({ id: v.id, t: v.t, mesa: v.mesa, pay: v.pagamento, total: v.total, ...(v.recebido != null ? { rec: v.recebido } : {}), it: itens[v.id] || [] }));
}

// ---- Senha (PIN): guardada com hash no banco; protege o histórico de vendas, a exclusão e o backup ----
const sessoes = new Map(), TTL = 30 * 60 * 1000;
let falhas = 0, bloqAte = 0;
const getCfg = k => { const r = all('SELECT valor FROM config WHERE chave=?', [k]); return r.length ? r[0].valor : null; };
const setCfg = (k, v) => { if (v === null) db.run('DELETE FROM config WHERE chave=?', [k]); else db.run('INSERT INTO config(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor', [k, v]); persist(); };
const temPin = () => !!getCfg('pin');
const hashPin = pin => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pin, salt, 32).toString('hex'); };
const confere = (pin, h) => { const [salt, x] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(x, 'hex'), crypto.scryptSync(pin, salt, 32)); };
const novaSessao = () => { const t = crypto.randomBytes(24).toString('hex'); sessoes.set(t, Date.now() + TTL); return t; };
const autorizado = req => { if (!temPin()) return true; const t = String(req.headers['x-token'] || ''), e = sessoes.get(t); if (e && e > Date.now()) { sessoes.set(t, Date.now() + TTL); return true; } sessoes.delete(t); return false; };
const negado = res => json(res, 401, { erro: 'Digite a senha para continuar.' });

async function handler(req, res) {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname;
    if (p === '/api/auth' && req.method === 'GET') return json(res, 200, { pin: temPin(), ok: autorizado(req) });
    if (p === '/api/auth/entrar' && req.method === 'POST') {
      const b = await body(req);
      if (!temPin()) return json(res, 200, { token: '' });
      if (Date.now() < bloqAte) return json(res, 429, { erro: 'Muitas tentativas erradas. Aguarde ' + Math.ceil((bloqAte - Date.now()) / 1000) + ' segundos.' });
      if (confere(String(b.pin || ''), getCfg('pin'))) { falhas = 0; return json(res, 200, { token: novaSessao() }); }
      if (++falhas >= 5) { falhas = 0; bloqAte = Date.now() + 30000; }
      return json(res, 401, { erro: 'Senha incorreta.' });
    }
    if (p === '/api/auth/sair' && req.method === 'POST') { sessoes.delete(String(req.headers['x-token'] || '')); return json(res, 200, { ok: true }); }
    if (p === '/api/auth/definir' && req.method === 'POST') {
      if (!autorizado(req)) return negado(res);
      const b = await body(req), novo = String(b.novo || '');
      if (novo === '') { setCfg('pin', null); sessoes.clear(); return json(res, 200, { token: '' }); }
      if (!/^\d{4,8}$/.test(novo)) return json(res, 400, { erro: 'A senha deve ter de 4 a 8 números.' });
      setCfg('pin', hashPin(novo)); sessoes.clear(); return json(res, 200, { token: novaSessao() });
    }
    if (p === '/api/estado') {
      if (req.method === 'GET') { const r = all("SELECT valor FROM estado WHERE chave='estado'"); return json(res, 200, r.length ? JSON.parse(r[0].valor) : {}); }
      if (req.method === 'PUT') { const b = await body(req); db.run("INSERT INTO estado(chave,valor) VALUES('estado',?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", [JSON.stringify(b)]); persist(); return json(res, 200, { ok: true }); }
    }
    if (p === '/api/vendas') {
      if (req.method === 'GET') {
        if (!autorizado(req)) return negado(res);
        const num = k => u.searchParams.has(k) && isFinite(Number(u.searchParams.get(k))) ? Number(u.searchParams.get(k)) : null;
        return json(res, 200, listarVendas(num('de'), num('ate')));
      }
      if (req.method === 'POST') {
        const v = await body(req);
        if (!Array.isArray(v.it) || typeof v.total !== 'number') return json(res, 400, { erro: 'Venda inválida' });
        db.run('BEGIN');
        try {
          db.run('INSERT INTO vendas(t,mesa,pagamento,total,recebido) VALUES(?,?,?,?,?)', [v.t, String(v.mesa), v.pay || '', v.total, typeof v.rec === 'number' ? v.rec : null]);
          const id = all('SELECT last_insert_rowid() AS id')[0].id;
          v.it.forEach(i => db.run('INSERT INTO venda_itens(venda_id,produto,qtd,preco) VALUES(?,?,?,?)', [id, i.n, i.q, i.p]));
          db.run('COMMIT'); persist(); return json(res, 200, { id });
        } catch (e) { db.run('ROLLBACK'); throw e; }
      }
    }
    const m = p.match(/^\/api\/vendas\/(\d+)$/);
    if (m && req.method === 'DELETE') {
      if (!autorizado(req)) return negado(res);
      db.run('DELETE FROM venda_itens WHERE venda_id=?', [+m[1]]); db.run('DELETE FROM vendas WHERE id=?', [+m[1]]); persist(); return json(res, 200, { ok: true });
    }
    if (p === '/api/backup') {
      if (!autorizado(req)) return negado(res);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="restaurante-' + hoje() + '.db"' }); return res.end(Buffer.from(db.export()));
    }
    const raiz = path.join(__dirname, 'public'), f = path.join(raiz, p === '/' ? 'index.html' : p.replace(/^\/+/, ''));
    if (!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  } catch (e) { console.error(e); json(res, 500, { erro: String(e.message || e) }); }
}

(async () => {
  const SQL = await initSqlJs({ wasmBinary: fs.readFileSync(path.join(__dirname, 'lib', 'sql-wasm.wasm')) });
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();
  db.run(SCHEMA);
  if (!all('PRAGMA table_info(vendas)').some(c => c.name === 'recebido')) db.run('ALTER TABLE vendas ADD COLUMN recebido REAL'); // valor recebido em dinheiro (para o troco)
  try { persist(); } catch (e) {
    console.error('\n  NÃO FOI POSSÍVEL GRAVAR NA PASTA: ' + DIR + '\n  Motivo: ' + e.message);
    console.error('\n  O que fazer:\n   1) Copie a pasta do sistema para o disco do computador (ex.: C:\\Emporio) e abra de lá.\n   2) Se for pen drive: confira se não está protegido contra gravação, cheio ou com erro.\n   3) Clique com o botão direito na pasta "dados" > Propriedades e desmarque "Somente leitura".\n   4) Apague o arquivo restaurante.db.tmp dentro de "dados", se existir.\n   5) Feche outras janelas pretas do sistema e programas de sincronização (OneDrive, Google Drive).\n');
    process.exit(1);
  }
  if (process.argv.includes('--resetar-senha')) { setCfg('pin', null); console.log('\n  Senha removida. Abra o sistema normalmente e crie uma nova senha na aba Ajustes.\n'); process.exit(0); }
  http.createServer(handler).listen(PORT, '0.0.0.0', () => {
    console.log('\n  EMPÓRIO CACHOEIRA DO SALTO - Sistema do restaurante\n  NÃO FECHE ESTA JANELA enquanto o restaurante estiver funcionando.\n');
    console.log('  Neste computador:      http://localhost:' + PORT);
    Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).forEach(i => console.log('  Outros aparelhos (Wi-Fi): http://' + i.address + ':' + PORT));
    console.log('\n  Banco de dados: ' + DB_FILE + '\n  Cópias diárias: ' + BK + '\n');
    if (process.platform === 'win32') exec('start "" http://localhost:' + PORT);
  }).on('error', e => { console.error(e.code === 'EADDRINUSE' ? '\n  O sistema já está aberto (porta ' + PORT + ' em uso). Feche a outra janela e tente de novo.' : e); });
})();
