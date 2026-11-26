/* eslint-disable prettier/prettier */
import { expect, test } from "bun:test";
import { Money } from "./money";

test('Preservar durante serialização', () => {
    const money = Money.from({ amount: "80.25", currency: "BRL" })

    const result = money.toJSON()

    expect(result).toEqual({
        amount: "80.25",
        currency: "BRL",
    })
})

test("subtrair sem alterar o saldo original", () => {
    const saldo = Money.from({ amount: "100.00", currency: "BRL" })
    const aposta = Money.from({ amount: "80.00", currency: "BRL" })

    const rest = saldo.subtract(aposta)

    expect(rest.toString()).toBe("20.00")
    expect(saldo.toString()).toBe("100.00")
});


for (const amount of ["", "NaN", "Infinity", "1e2", "-1.00", "1.001"]) {
    test(`rejeita o valor inválido "${amount}"`, () => {
        expect(() =>
            Money.from({ amount, currency: "BRL" }),
        ).toThrow("Valor monetário inválido");
    });
}


test("verificação de valores", () => {
    const saldo1 = Money.from({ amount: "10.00", currency: "BRL" })
    const saldo2 = Money.from({ amount: "20.00", currency: "BRL" })

    const verdade = saldo1.isLessThan(saldo2)
    const falso = saldo2.isLessThan(saldo1)

    expect(verdade).toEqual(true)
    expect(falso).toEqual(false)
})

test("negar um saldo e tranformar em JSON", () => {
    const money = Money.from({ amount: "0.05", currency: "BRL" })

    const negativo = money.negate()

    expect(negativo.toJSON()).toEqual(
        {
            amount: "-0.05",
            currency: "BRL"
        }
    )
})

test("Soma de valores", () => {
    const money = Money.from({ amount: "0.10", currency: "BRL" })
    const prize = Money.from({ amount: "0.20", currency: "BRL" })

    const result = money.add(prize)

    expect(result.toString()).toBe("0.30")
})

test("Verificar se o valor está zerado mesmo", () => {
    const money = Money.zero("BRL")

    const zerado = money.isZero()

    expect(money.toJSON()).toEqual({ amount: "0.00", currency: "BRL" })
    expect(zerado).toBe(true)
})

test("Verificar se é negativo e positivo", () => {
    const saldo = Money.from({ amount: "10.00", currency: "BRL" })

    const negativo = saldo.negate()

    expect(negativo.isNegative()).toBe(true)
    expect(saldo.isPositive()).toBe(true)
})

test("verificar se são iguals", () => {
    const saldo1 = Money.from({ amount: "10.00", currency: "BRL" })
    const saldo2 = Money.from({ amount: "10.00", currency: "BRL" })

    const result = saldo1.equals(saldo2)

    expect(result).toBe(true)
})

test("soma de moedas diferentes", () => {
    const saldo1 = Money.from({ amount: "10.00", currency: "BRL" })
    const saldo2 = Money.from({ amount: "10.00", currency: "USD" })
    expect(() => {
        saldo1.add(saldo2)
    }).toThrow("Moeda incompatível")
})
