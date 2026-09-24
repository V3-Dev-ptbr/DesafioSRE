# Em Busca de Soft Skills

Projeto desenvolvido para o desafio **SRE Backend Arena**.

## Cenário escolhido

Pokémon Battle — endpoint `GET /battle?pokemonA=...&pokemonB=...`, que consulta a [PokéAPI](https://pokeapi.co/) e decide o vencedor comparando a soma dos status base de cada pokémon.

## Arquitetura e decisões técnicas

**Aplicação:** Node.js + Express.

**Confiabilidade:**
- Timeout de 3s em todas as chamadas à API externa, para nunca travar esperando indefinidamente.
- Retry automático com backoff exponencial (`axios-retry`), até 3 tentativas.
- Cache em memória com TTL de 60s, reduzindo chamadas repetidas à PokéAPI e respeitando limites de uso da API externa.
- Circuit breaker (`opossum`): abre após 50% de falhas nas chamadas e aguarda 10s antes de tentar novamente, evitando sobrecarregar uma dependência já instável.

**Observabilidade:**
- Logs estruturados em JSON (`pino`), com identificador único por requisição.
- Métricas no formato Prometheus expostas em `/metrics` (total de requisições, erros e duração por rota).
- Health check em `/health`.

**Infraestrutura:**
- Containerizado com Docker (`node:lts-alpine`).
- Deploy em Kubernetes local (kind), com limites de recursos definidos no manifesto (`requests`: 250m CPU / 128Mi, `limits`: 500m CPU / 256Mi).
- Pipeline de CI (GitHub Actions): instala dependências, verifica sintaxe, roda testes, constrói a imagem Docker e valida os arquivos do Kubernetes a cada push.

## Resultados do teste de carga

Ferramenta: [k6](https://k6.io/). Cenário: rampa de até 20 usuários virtuais simultâneos, sustentados por 20s (40s de teste no total).

| Métrica | Resultado |
|---|---|
| Requisições totais | 5.904 |
| Taxa de sucesso | 100% (0 falhas) |
| Requisições/segundo | ~147 |
| Latência média | 1.75ms |
| Latência p95 | 2.25ms |
| Latência máxima | 349ms (primeira chamada, antes do cache aquecer) |

## Limitações conhecidas e próximos passos

- O teste de carga foi executado localmente contra uma única réplica; a meta de 10.000 req/s do desafio exigiria múltiplas réplicas atrás de um balanceador de carga real — o `kubectl port-forward` usado durante o desenvolvimento local não é adequado para isso, pois tem limite de conexões concorrentes (confirmado durante os testes deste projeto).
- Os testes automatizados na pipeline de CI são atualmente um placeholder; o próximo passo seria isolar e testar a lógica de decisão do vencedor da batalha.
- A infraestrutura como código cobre os manifestos do Kubernetes; ferramentas como Terraform para o restante do ambiente (rede, monitoramento) ficam como evolução futura.

## Como rodar localmente

```bash
npm install
node server.js
```

Ou via Docker:

```bash
docker build -t sre-backend-arena:latest .
docker run -p 3000:3000 sre-backend-arena:latest
```

Ou via Kubernetes local (kind):

```bash
kind create cluster --name sre-arena
kind load docker-image sre-backend-arena:latest --name sre-arena
kubectl apply -f deployment.yaml
kubectl apply -f service.yaml
kubectl port-forward svc/sre-backend-arena 3000:3000
```

Teste com:

```
http://localhost:3000/battle?pokemonA=pikachu&pokemonB=charmander
```
