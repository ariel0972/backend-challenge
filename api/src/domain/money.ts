/* eslint-disable prettier/prettier */
export interface MoneyProps {
  amount: string;
  currency: string;
}

export class Money {
  private constructor(
    private readonly cents: bigint,
    public readonly currency: string,
  ) { }

  static from(props: MoneyProps): Money {
    if (typeof props.amount !== "string" || !/^[0-9]+\.[0-9]{2}$/.test(props.amount)) {
      throw new Error("Valor monetário inválido");
    }

    if (typeof props.currency !== "string" || !["BRL", "USD"].includes(props.currency)) {
      throw new Error("Moeda não suportada");
    }

    const values = props.amount.split('.')
    const inteiro = BigInt(values[0])
    const decimal = BigInt(values[1])

    const cents = inteiro * 100n + decimal

    return new Money(cents, props.currency)
  }

  static zero(currency: string): Money {
    return Money.from({ amount: "0.00", currency })
  }

  add(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.cents + other.cents, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other)
    return new Money(this.cents - other.cents, this.currency)
  }

  negate(): Money {
    return new Money(this.cents * -1n, this.currency)
  }

  isZero(): boolean {
    return this.cents === 0n
  }

  isPositive(): boolean {
    return this.cents > 0n
  }

  isNegative(): boolean {
    return this.cents < 0n
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other)
    return this.cents < other.cents
  }

  equals(other: Money): boolean {
    this.assertSameCurrency(other)
    return other.cents === this.cents
  }

  toJSON(): MoneyProps {
    return { amount: this.toString(), currency: this.currency }
  }

  toString(): string {
    const negativo = this.cents < 0n
    const absoluto = negativo ? -this.cents : this.cents

    const inteiro = absoluto / 100n;
    const decimal = absoluto % 100n;

    const decimalFormatado = decimal.toString().padStart(2, "0")
    const amount = `${negativo ? "-" : ""}${inteiro}.${decimalFormatado}`

    return amount
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error("Moeda incompatível")
    }
  }
}
