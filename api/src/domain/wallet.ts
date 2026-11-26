/* eslint-disable prettier/prettier */
import { Money } from "./money";

interface OpenWalletProps {
    id: string;
    playerId: string;
    initialBalance: Money;
}

export interface WalletState {
    id: string;
    playerId: string;
    currency: string;
    balance: Money;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

export class Wallet {
    private constructor(
        public readonly id: string,
        public readonly playerId: string,
        public readonly currency: string,
        private _balance: Money,
        private _version: number,
        private readonly _createdAt: Date,
        private _updatedAt: Date,
    ) { }

    static open(props: OpenWalletProps): Wallet {
        if (props.initialBalance.isNegative()) throw new Error("Saldo Inicial inválido")
        const moeda = props.initialBalance.currency
        const now = new Date()

        return new Wallet(props.id, props.playerId, moeda, props.initialBalance, 1, now, now)
    }

    static rehydrate(state: WalletState): Wallet {
        return new Wallet (
            state.id,
            state.playerId,
            state.currency,
            state.balance,
            state.version,
            new Date(state.createdAt.getTime()),
            new Date(state.updatedAt.getTime())
        )
    }

    get balance(): Money {
        return this._balance;
    }

    get version(): number {
        return this._version;
    }

    get updatedAt(): Date {
        return new Date(this._updatedAt.getTime())
    }

    get createdAt(): Date {
        return new Date(this._createdAt.getTime())
    }
    
    debit(amount: Money): void {
        if (amount.currency !== this.currency) {
            throw new Error("Moeda inválida");
        }
        if (!amount.isPositive()) {
            throw new Error("Valor inválido")
        }
        if (this._balance.isLessThan(amount)) {
            throw new Error("Saldo insuficiente")
        }

        this._balance = this._balance.subtract(amount)
        this._version++
        this._updatedAt = new Date()
        // Validar antes de mudar qualquer estado.
    }

    credit(amount: Money): void {
        if (amount.currency !== this.currency) {
            throw new Error("Moeda inválida")
        }
        if (!amount.isPositive()) {
            throw new Error("Valor inválido")
        }

        this._balance = this._balance.add(amount)
        this._version++
        this._updatedAt = new Date()
        // Validar antes de mudar qualquer estado.
    }
}
