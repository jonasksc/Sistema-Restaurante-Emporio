# 🍽️ Sistema de Restaurante

Sistema de gestão desenvolvido para auxiliar no controle das atividades de um restaurante, reunindo informações importantes do negócio em uma aplicação executada localmente.

O projeto surgiu de uma necessidade real: oferecer a um restaurante uma forma mais prática de acompanhar suas operações e organizar os dados do dia a dia.

## 📌 Sobre o projeto

A aplicação foi desenvolvida com **Node.js** e **SQLite**. Atualmente, funciona em um computador e mantém os dados armazenados localmente, mesmo após fechar a aplicação.

Seu foco é simplificar rotinas de gestão, com atenção especial a **vendas** e **estoque**.

## ✅ Funcionalidades já informadas

- Controle de vendas.
- Controle de estoque.
- Persistência de dados em banco de dados local.
- Utilização no computador em que o sistema está instalado/configurado.

> **Observação:** esta lista descreve apenas as funcionalidades confirmadas até agora. As demais telas e módulos podem ser incluídos após uma revisão do projeto.

## 🛠️ Tecnologias

| Tecnologia | Uso no projeto |
| --- | --- |
| **Node.js** | Execução da aplicação e regras de negócio. |
| **SQLite** | Armazenamento dos dados. |
| **JavaScript** | Desenvolvimento no ambiente Node.js. |

## 💻 Como executar localmente

**Pré-requisitos:** Node.js e npm instalados.

1. Baixe ou clone este repositório.
2. Abra um terminal na pasta do projeto.
3. Instale as dependências:

   ```bash
   npm install
   ```

4. Confira os comandos disponíveis no `package.json`:

   ```bash
   npm run
   ```

5. Execute o script de inicialização definido pelo projeto (por exemplo, `npm start`, **somente se** o script `start` existir).

> O comando exato de inicialização, a porta de acesso e eventuais configurações adicionais ainda precisam ser verificados no código-fonte.

## 🗄️ Armazenamento de dados

Os dados são mantidos em um banco **SQLite** local. Como o sistema ainda opera em um único computador, esta versão não deve ser apresentada como uma solução multiusuário em rede.

**Importante:** antes de publicar o repositório, remova dados reais de clientes e informações confidenciais. Não envie arquivos `.env`, credenciais ou cópias do banco de produção para o GitHub.

## 🔜 Melhorias consideradas para próximas versões

Estas são **possibilidades de evolução**, e não funcionalidades já implementadas:

- Processo de backup e restauração do banco de dados.
- Aperfeiçoamento de relatórios de gestão.
- Melhorias na instalação e distribuição do sistema para Windows.
- Revisão de segurança, permissões e tratamento de erros.

## 📷 Demonstração

*Adicione aqui capturas de tela das principais áreas do sistema, como vendas e estoque, sem expor informações reais de clientes.*

## 📚 Aprendizados

Este projeto representa uma experiência prática na construção de sistemas para necessidades reais, incluindo o uso de **Node.js**, **SQLite** e ferramentas de **inteligência artificial como apoio ao desenvolvimento**.

---

**Status:** sistema desenvolvido e em evolução.

## 👤 Autor

**Jonas Kaique Souza Cruz**  
[GitHub](https://github.com/jonasksc) · [LinkedIn](https://www.linkedin.com/in/jonasksc/)
