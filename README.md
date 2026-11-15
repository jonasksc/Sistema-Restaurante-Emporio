# 🍽️ Sistema de Restaurante — Empório Cachoeira

Sistema de gestão desenvolvido para auxiliar no controle das atividades do Empório Cachoeira, reunindo em uma aplicação local as principais rotinas do restaurante.

O projeto surgiu de uma necessidade real: oferecer uma forma prática de acompanhar as operações e organizar os dados do dia a dia.

## 📌 Sobre o projeto

A aplicação foi desenvolvida com **Node.js**, **JavaScript** e **SQLite** (usando a biblioteca sql.js). O sistema é executado no computador principal, e os dados ficam armazenados localmente.

Além do uso no computador principal, funcionários podem acessar o sistema pelo navegador do celular quando estão conectados à mesma rede Wi-Fi, após a configuração inicial do administrador.

## ✅ Funcionalidades

- Controle de mesas, comandas e pedidos.
- Cadastro de produtos e controle de estoque.
- Registro de vendas e formas de pagamento.
- Contas pendentes para pagamento posterior.
- Controle de caixa e relatórios, incluindo comprovantes em PDF.
- Cadastro de funcionários, PINs e perfis de acesso.
- Diagnóstico automático dos principais componentes na inicialização.
- Acesso pelo celular na mesma rede Wi-Fi do computador principal.

As abas **Cozinha** e **Ficha Técnica** estão ocultas nesta versão.

## 🛠️ Tecnologias

| Tecnologia | Uso no projeto |
| --- | --- |
| **Node.js** | Execução do servidor e das regras do sistema. |
| **SQLite / sql.js** | Armazenamento local dos dados. |
| **JavaScript** | Desenvolvimento do servidor, da interface e das rotinas auxiliares. |
| **HTML** | Interface acessada pelo navegador. |

## 💻 Como executar no Windows

1. Extraia todo o pacote ZIP para uma pasta. Não execute o sistema de dentro do ZIP.
2. Abra a pasta **Sistema Emporio Cachoeira**.
3. Dê dois cliques em `iniciar.bat`.
4. Aguarde o diagnóstico e a abertura do navegador. O endereço local normalmente começa com `http://127.0.0.1:3000/`.
5. Se o Node.js não estiver instalado, siga a instrução do iniciador para usar o instalador offline incluído no pacote.

Mantenha a janela preta aberta enquanto usa o sistema. Para encerrar, pressione `Ctrl+C` nessa janela.

## 📱 Acesso pelo celular

Depois de configurar o PIN do administrador no primeiro acesso, feche e inicie o sistema novamente. O computador principal exibirá o endereço para acesso pela rede local.

Conecte o celular à mesma rede Wi-Fi do computador e abra no navegador o endereço IP e a porta mostrados pelo iniciador. O computador principal mantém o banco de dados usado pelos aparelhos conectados. O acesso não é destinado à internet pública.

## 🗄️ Armazenamento e backups

Os dados são mantidos localmente em `dados/restaurante.db`. O sistema também cria backups locais em `dados/backups` e permite exportar um backup pelo perfil Administrador.

Faça cópias adicionais em um local seguro. Ao instalar uma versão nova, não substitua um banco de dados mais recente pelo arquivo de exemplo incluído no pacote, pois isso pode apagar vendas e cadastros.

Antes de publicar o projeto no GitHub, confira se o banco de dados ou os backups contêm informações reais de clientes, vendas ou funcionários. Não publique esses dados nem credenciais ou PINs.

## 🔜 Possíveis melhorias futuras

Estas são possibilidades de evolução, não funcionalidades confirmadas nesta versão:

- Aprimorar relatórios de gestão.
- Melhorar o processo de instalação e distribuição para Windows.
- Revisar continuamente segurança, permissões e tratamento de erros.

## 📚 Aprendizados

Este projeto representa uma experiência prática na construção de um sistema para uma necessidade real, incluindo o uso de **Node.js**, **SQLite**, desenvolvimento de interfaces web e ferramentas de **inteligência artificial como apoio ao desenvolvimento**.

---

**Status:** sistema funcional, executado localmente e em evolução.

## 👤 Autor

**Jonas Kaique Souza Cruz**  
[GitHub](https://github.com/jonasksc) · [LinkedIn](https://www.linkedin.com/in/jonasksc/)

