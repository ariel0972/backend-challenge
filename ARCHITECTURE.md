# Arquitetura

## Organização

- domain: representação monetária, carteira e eventos de integração.
- application: abertura de carteira, operações financeiras,
  reprocessamento de referências e reconciliação.
- infrastructure/database: persistência PostgreSQL via MikroORM,
  mapeamento e migrations.
- infrastructure/messaging: consumidor SQS, inbox e publisher de outbox.
- http: validação de entrada e tradução de resultados para HTTP.

## Precisão monetária

Money representa valores em centavos usando bigint.
O contrato externo utiliza strings decimais com duas casas.
No PostgreSQL, valores são armazenados em numeric(20,2).

O escopo de moedas aceitas é BRL e USD.
Não são usados cálculos de dinheiro em ponto flutuante.

## Persistência e concorrência

MikroORM foi escolhido pelo controle explícito do EntityManager,
Unit of Work e transações.

A carteira de domínio é separada da entidade de persistência por um mapper.

Operações financeiras adquirem lock pessimista na carteira.
O PostgreSQL serializa alterações na mesma carteira, inclusive entre
instâncias diferentes da aplicação.

A atualização de saldo, transação, ledger, inbox e outbox participa
da mesma transação quando aplicável.

Constraints garantem saldo não negativo, versão positiva e unicidade.
Triggers impedem UPDATE, DELETE e TRUNCATE do ledger.

## Idempotência

A chave é persistida com unicidade no PostgreSQL.
No HTTP, a fonte da chave é o header Idempotency-Key.

O hash SHA-256 é calculado sobre um JSON com chaves ordenadas contendo
os campos de negócio. Valores monetários são normalizados e UUIDs
selecionados são convertidos para minúsculas.

Repetições retornam a resposta armazenada, incluindo o saldo histórico.
Uma chave reutilizada com conteúdo diferente é um conflito.

A inbox deduplica mensagens por consumerName e messageId.
Sua proteção é persistente e não depende da deduplicação do SQS FIFO.

## Operações e referências

BET debita, WIN credita e LOSS não altera o saldo.

REFUND e ROLLBACK validam a operação referenciada e geram lançamentos
compensatórios. O ledger original não é modificado.

Referências ausentes produzem PENDING_REFERENCE.
Um worker tenta novamente com backoff e limites de tentativas e tempo.

## SQS e outbox

O consumidor reutiliza o mesmo caso de uso da entrada HTTP.
DeleteMessage ocorre somente depois do commit.

Rejeições de negócio são confirmadas.
Erros permanentes são enviados à DLQ.
Falhas transitórias recebem backoff e estão sujeitas à redrive policy.

A outbox persiste eventos antes de qualquer publicação.
Publishers selecionam eventos usando FOR UPDATE SKIP LOCKED.

Uma falha depois do envio e antes da confirmação no banco pode causar
republicação. O eventId permanece estável: consumidores de eventos
devem deduplicá-lo.

O publisher mantém uma transação durante uma chamada SQS com timeout.
É uma escolha de simplicidade para este desafio, com custo de manter
uma conexão ocupada durante a chamada externa.

Não se promete ordenação total dos eventos entre publishers.
Eventos de saldo incluem a versão da carteira.

## Reconciliação

Compara o saldo materializado com créditos menos débitos do ledger
em uma transação com snapshot consistente.

Divergências são reportadas, sem correção silenciosa.

## Encerramento

Workers param de receber novos trabalhos e aguardam as operações
em andamento antes do fechamento do ORM.

## Autenticação

Autenticação não foi implementada neste recorte.
Em produção, a entrada HTTP deveria validar tokens de um IdP externo
e associar a identidade autenticada ao providerId autorizado.

A fila é tratada como canal interno; seus dados continuam sujeitos
às validações de entrada e de negócio.

## Evidências e limitações

Foram executados testes de:
- disputa de duas apostas sobre o mesmo saldo;
- repetições e conflito de idempotência;
- reconciliação e divergência;
- imutabilidade do ledger;
- rollback financeiro após falha no ledger;
- WIN, LOSS, REFUND, ROLLBACK e referência fora de ordem.

O smoke SQS confirmou deduplicação por inbox, efeito financeiro único
e publicação de eventos da outbox.

Pendências conhecidas:
- testes automatizados de crash real e recuperação;
- teste com pelo menos três processos concorrentes;
- testes específicos de publishers concorrentes e retry/DLQ;
- métricas completas exigidas pelo desafio;
- indicador explícito idempotentReplay na resposta HTTP;
- maior encapsulamento das transições de transação e mensageria;
- containerização da aplicação: o Compose atual sobe as dependências;
- revisão final de lint e tipagem dos scripts auxiliares.

O LocalStack é usado para desenvolvimento. A durabilidade das filas
após recriação do emulador não foi validada.