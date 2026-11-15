'use strict';
// Diagnostico de inicializacao: verificacoes reais, sem alterar o banco SQLite.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');

function linha(rotulo, status, detalhe = '') {
  const prefixo = status === 'ok' ? '[OK]' : status === 'aviso' ? '[AVISO]' : '[ERRO]';
  console.log(`${prefixo} ${rotulo}${detalhe ? ' - ' + detalhe : ''}`);
}
function registrarErro(base, etapa, error) {
  try {
    const pasta = path.join(base, 'dados');
    fs.mkdirSync(pasta, { recursive: true });
    fs.appendFileSync(path.join(pasta, 'diagnostico-inicializacao.log'),
      `${new Date().toISOString()} [${etapa}] ${String(error?.message || error)}\n`, 'utf8');
  } catch (_) { /* Uma pasta sem permissao pode impedir ate mesmo o log. */ }
}
function verificarArquivo(root, rel, minimo = 1) {
  const arquivo = path.join(root, rel);
  const stat = fs.statSync(arquivo);
  if (!stat.isFile() || stat.size < minimo) throw new Error(`${rel} ausente ou incompleto`);
}
async function verificarAntes(root, base = root) {
  const falhas = [];
  const verificar = async (titulo, fn) => {
    try {
      const detalhe = await fn();
      if (detalhe && typeof detalhe === 'object' && detalhe.aviso) linha(titulo, 'aviso', detalhe.aviso);
      else linha(titulo, 'ok', detalhe);
    } catch (error) {
      linha(titulo, 'erro', error.message);
      registrarErro(base, titulo, error);
      falhas.push(titulo);
    }
  };
  console.log('\n=============== DIAGNOSTICO DO SISTEMA ===============');
  await verificar('Node.js', () => {
    const major = Number(process.versions.node.split('.')[0]);
    if (major < 18) throw new Error('versao antiga; instale Node.js 18 ou superior');
    return 'versao ' + process.version;
  });
  await verificar('Interface', () => {
    verificarArquivo(root, 'public/index.html', 1000);
    verificarArquivo(root, 'public/jspdf.min.js', 1000);
    return 'arquivos HTML e PDF encontrados';
  });
  await verificar('Servidor', () => {
    for (const arquivo of ['server.js', 'launcher.js', 'instance-lock.js', 'safe-storage.js']) verificarArquivo(root, arquivo, 50);
    return 'arquivos principais encontrados';
  });
  let sqlJs = null;
  await verificar('SQLite', async () => {
    verificarArquivo(root, 'lib/sql-wasm.wasm', 10000);
    sqlJs = await require(path.join(root, 'node_modules', 'sql.js'))({
      wasmBinary: fs.readFileSync(path.join(root, 'lib', 'sql-wasm.wasm')),
    });
    return 'biblioteca carregada';
  });
  await verificar('Pasta de dados', () => {
    const dir = path.join(base, 'dados');
    fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, '.teste-gravacao-' + process.pid + '-' + crypto.randomBytes(5).toString('hex'));
    try { fs.writeFileSync(tmp, 'teste', { flag: 'wx', mode: 0o600 }); }
    finally { try { fs.unlinkSync(tmp); } catch (_) {} }
    return 'leitura e escrita permitidas';
  });
  if (sqlJs) {
    await verificar('Banco de dados', () => {
      const arquivo = path.join(base, 'dados', 'restaurante.db');
      if (!fs.existsSync(arquivo)) {
        return { aviso: 'primeiro uso: banco novo sera criado pelo servidor' };
      }
      let banco;
      try {
        banco = new sqlJs.Database(fs.readFileSync(arquivo));
        const resultado = banco.exec('PRAGMA integrity_check');
        if (resultado[0]?.values?.[0]?.[0] !== 'ok') throw new Error('verificacao de integridade falhou');
        const tabelas = banco.exec("SELECT name FROM sqlite_master WHERE type='table'");
        const nomes = new Set((tabelas[0]?.values || []).map(v => v[0]));
        if (nomes.size && !['estado', 'vendas', 'config'].some(t => nomes.has(t))) {
          throw new Error('arquivo SQLite nao parece pertencer ao Emporio; verifique a pasta dados');
        }
        return 'integridade SQLite confirmada';
      } finally { banco?.close(); }
    });
  } else {
    linha('Banco de dados', 'erro', 'nao foi possivel verificar sem a biblioteca SQLite');
    falhas.push('Banco de dados');
  }
  if (falhas.length) {
    console.error('\n[ERRO] Inicializacao interrompida. Consulte os itens acima e o arquivo dados\\diagnostico-inicializacao.log.');
    return false;
  }
  console.log('-----------------------------------------------------');
  return true;
}
function requisicao(port, rota) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: rota, timeout: 2500 }, resp => {
      let texto = '';
      resp.on('data', chunk => { texto += chunk.toString('utf8'); if (texto.length > 1000000) req.destroy(new Error('resposta muito grande')); });
      resp.on('end', () => resolve({ status: resp.statusCode, tipo: resp.headers['content-type'] || '', texto }));
    });
    req.on('timeout', () => req.destroy(new Error('tempo limite excedido')));
    req.on('error', reject);
  });
}
async function verificarDepois(port, base) {
  const falhas = [];
  async function testar(rotulo, caminho, validade) {
    try {
      const resposta = await requisicao(port, caminho);
      if (!validade(resposta)) throw new Error(`resposta inesperada (HTTP ${resposta.status})`);
      linha(rotulo, 'ok', `HTTP ${resposta.status}`);
    } catch (error) {
      linha(rotulo, 'erro', error.message);
      registrarErro(base, rotulo, error);
      falhas.push(rotulo);
    }
  }
  await testar('Sistema', '/api/saude', r => r.status === 200 && JSON.parse(r.texto).ok === true);
  await testar('Interface web', '/', r => r.status === 200 && /text\/html/i.test(r.tipo) && /Emp[oó]rio Cachoeira/i.test(r.texto));
  await testar('Geracao de PDF', '/jspdf.min.js', r => r.status === 200 && /javascript/i.test(r.tipo));
  if (falhas.length) {
    console.error('[ERRO] Servidor iniciou, mas uma ou mais verificacoes falharam.');
    return false;
  }
  return true;
}
module.exports = { verificarAntes, verificarDepois, requisicao, registrarErro };
