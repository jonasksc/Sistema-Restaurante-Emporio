'use strict';
// Iniciador para Windows: verifica se a porta está livre ou se outro Empório está aberto.
// Nunca encerra processos de terceiros e jamais inicia duas cópias sobre o mesmo banco.
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { verificarAntes, verificarDepois, registrarErro } = require('./diagnostico-inicializacao');
const portStart = Number(process.env.PORT || 3000);
const base = process.env.EMPORIO_BASE || __dirname;
const host = process.env.EMPORIO_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const identity = crypto.createHash('sha256').update(path.resolve(base, 'dados', 'restaurante.db').toLowerCase()).digest('hex');

function probe(port, endpoint = '/api/identidade') {
  return new Promise(resolve => {
    let done = false;
    function finish(v) { if (!done) { done = true; resolve(v); } }
    const request = http.get({ hostname: '127.0.0.1', port, path: endpoint, timeout: 1200 }, response => {
      let raw = '';
      response.on('data', ch => { raw += ch; if (raw.length > 32768) request.destroy(); });
      response.on('end', () => {
        let data = null;
        try { data = JSON.parse(raw); } catch (_) {}
        finish({ busy: true, status: response.statusCode, data });
      });
      response.on('error', () => finish({ busy: true }));
    });
    request.on('timeout', () => { request.destroy(); finish({ busy: true }); });
    request.on('error', e => finish({ busy: e.code !== 'ECONNREFUSED' }));
  });
}
function openBrowser(url) {
  if (process.env.EMPORIO_SEM_NAVEGADOR === '1') return;
  if (process.platform !== 'win32') {
    console.log('Abra o navegador em:', url);
    return;
  }
  // Abrir diretamente o manipulador de URLs padrão do Windows evita
  // a interpretação das aspas do comando `cmd /s /c start`.
  // Caso o Windows recuse este método, tenta as alternativas abaixo.
  const methods = [
    ['rundll32.exe', ['url.dll,FileProtocolHandler', url]],
    ['explorer.exe', [url]],
    ['cmd.exe', ['/d', '/c', 'start', '""', url]],
  ];
  function attempt(index) {
    if (index >= methods.length) {
      console.warn('Nao foi possivel solicitar a abertura automatica do navegador.');
      console.warn('Abra manualmente: ' + url);
      return;
    }
    const [program, args] = methods[index];
    let child;
    try {
      child = spawn(program, args, { windowsHide: true, stdio: 'ignore' });
    } catch (error) {
      console.warn('Abertura pelo metodo ' + (index + 1) + ' falhou: ' + error.message);
      attempt(index + 1);
      return;
    }
    let failed = false;
    child.once('error', error => {
      if (failed) return;
      failed = true;
      console.warn('Abertura pelo metodo ' + (index + 1) + ' falhou: ' + error.message);
      attempt(index + 1);
    });
    child.once('close', code => {
      if (failed || code === 0) return;
      failed = true;
      console.warn('Abertura pelo metodo ' + (index + 1) + ' retornou codigo ' + code);
      attempt(index + 1);
    });
  }
  attempt(0);
}
async function main() {
  console.log('\n=== EMPÓRIO CACHOEIRA — INICIADOR REVISADO ===');
  console.log('Pasta de dados:', path.join(base, 'dados'));
  if (!(await verificarAntes(__dirname, base))) { process.exitCode = 1; return; }
  let chosen = null;
  for (let port = portStart; port < portStart + 10; port++) {
    const found = await probe(port);
    if (!found.busy) { chosen = port; break; }
    if (found.status === 200 && found.data?.app === 'emporio-cachoeira') {
      if (found.data.identity === identity) {
        if (host === '0.0.0.0' && found.data.host !== '0.0.0.0') {
          console.log('O Empório já está aberto somente no computador. Feche a outra janela e inicie pelo modo REDE.');
          process.exitCode = 2;
          return;
        }
        console.log('[OK] Sistema ja aberto nesta pasta de dados (sem iniciar segunda instancia).');
        if (!(await verificarDepois(port, base))) { process.exitCode = 1; return; }
        console.log('Endereço: http://127.0.0.1:' + port);
        openBrowser('http://127.0.0.1:' + port);
        return;
      }
      console.log('Porta ' + port + ': outro Empório com banco diferente já está aberto.');
      continue;
    }
    const legacy = await probe(port, '/api/auth');
    if (legacy.status === 200 && typeof legacy.data?.pin === 'boolean' && typeof legacy.data?.ok === 'boolean') {
      console.log('Uma versão anterior do Empório está aberta na porta ' + port + '.');
      console.log('Por segurança, feche essa versão antes de iniciar o sistema atualizado.');
      console.log('Verifique processos com: netstat -ano | findstr :' + port);
      process.exitCode = 2;
      return;
    }
    console.log('Porta ' + port + ' ocupada por outra aplicação; tentando a próxima.');
  }
  if (chosen == null) throw new Error('Nenhuma porta livre entre ' + portStart + ' e ' + (portStart + 9) + '.');
  process.env.PORT = String(chosen);
  process.env.EMPORIO_HOST = host;
  const server = await require('./server').start();
  console.log('[OK] Banco de dados - carregado e persistido pelo servidor.');
  if (!(await verificarDepois(chosen, base))) {
    console.error('[ERRO] Sistema nao esta pronto para uso; encerrando o servidor.');
    await new Promise(resolve => server.close(resolve));
    process.exitCode = 1;
    return;
  }
  console.log('[OK] Servidor ativo na porta ' + chosen);
  console.log('[OK] Banco e interface verificados; sistema pronto para uso.');
  const bindHost=server.address().address;
  const redeAtiva=bindHost==='0.0.0.0'||bindHost==='::';
  const url = 'http://127.0.0.1:' + chosen + '/';
  try {
    fs.writeFileSync(path.join(base, 'dados', 'endereco-local.txt'), url + '\r\n', 'utf8');
  } catch (error) {
    console.warn('Nao foi possivel salvar o endereco local para o atalho: ' + error.message);
  }
  console.log('\nSistema iniciado e página inicial disponível em: ' + url);
  if(host === '0.0.0.0' && !redeAtiva) {
    console.log('[AVISO] Wi-Fi desativado ate criar o PIN do administrador e reiniciar.');
    console.log('PRIMEIRO ACESSO: crie o PIN de 4 numeros e depois reinicie o sistema para usar o Wi-Fi.');
  }
  if(redeAtiva) {
    const ips=Object.entries(os.networkInterfaces()).flatMap(([rede,lista])=>
      (lista||[]).filter(x=>x && x.family==='IPv4' && !x.internal && (/^192\.168\./.test(x.address)||/^10\./.test(x.address)||/^172\.(1[6-9]|2\d|3[01])\./.test(x.address)))
        .map(x=>({rede,ip:x.address})))
      .sort((a,b)=>Number(/virtual|vEthernet|wsl|vpn|vmware|virtualbox|docker|hyper-v|tailscale|zerotier/i.test(a.rede))-
                       Number(/virtual|vEthernet|wsl|vpn|vmware|virtualbox|docker|hyper-v|tailscale|zerotier/i.test(b.rede)));
    if(ips.length){console.log('[OK] Servidor habilitado na rede local (acesso pelo celular depende do roteador e firewall).');console.log('\nENDERECO PARA ACESSAR PELO CELULAR (mesmo Wi-Fi):');for(const {rede,ip} of ips)console.log('  '+rede+': http://'+ip+':'+chosen+'/');}
    else console.log('[AVISO] Wi-Fi: nenhum IPv4 privado encontrado; confira ipconfig e conexao ao roteador.');
    console.log('Se nao abrir no celular: verifique rede PRIVADA, firewall e isolamento entre dispositivos.');
    console.log('Para diagnosticar o Wi-Fi, veja LEIA-ME-PRIMEIRO.txt (ou use iniciar.bat diagnostico).');
    console.log('Para autorizar o Firewall de uma rede PRIVADA, veja LEIA-ME-PRIMEIRO.txt (iniciar.bat firewall).');
    console.log('Nao exponha este aplicativo na internet nem use em Wi-Fi publico.');
  }
  console.log('Mantenha esta janela aberta. Para encerrar, use Ctrl+C ou feche a janela.');
  openBrowser(url);
  return server;
}
if (require.main === module) main().catch(e => {
  if (e.code === 'EADDRINUSE') console.error('A porta ficou ocupada enquanto o sistema iniciava. Feche a outra instância e tente de novo.');
  else console.error('[ERRO] Não foi possível iniciar:', e.message);
  registrarErro(base, 'Inicializacao', e);
  process.exitCode = 1;
});
module.exports = { probe, main };
