/* eslint-disable prettier/prettier */
import { expect, test } from "bun:test";
import { Money } from "./money";
import { Wallet } from "./wallet";

test("debita uma vez e preserva o estado ao rejeitar por falta de saldo", () => {
  const wallet = Wallet.open({
    id: "wallet-1",
    playerId: "player-1",
    initialBalance: Money.from({ amount: "100.00",currency: "BRL",}),
  })
  
  expect(wallet.version).toBe(1);

  const aposta = Money.from({ amount: "80.00",currency: "BRL",});
  wallet.debit(aposta);


  expect(wallet.balance.toString()).toBe("20.00");
  expect(wallet.version).toBe(2);

  const ultimaAtualizacao = wallet.updatedAt.getTime();
  expect(() => 
    wallet.debit(aposta)).toThrow("Saldo insuficiente");


  expect(wallet.balance.toString()).toBe("20.00");
  expect(wallet.version).toBe(2);
  
  expect(wallet.updatedAt.getTime()).toBe(ultimaAtualizacao);
});