/* eslint-disable prettier/prettier */
import { Wallet } from "../../domain/wallet";
import { Money } from "../../domain/money";
import { WalletEntity } from "./wallet.entity";

export class WalletMapper {
    static toEntity(wallet: Wallet): WalletEntity {
        //reconstróia entidade do banco 'manualmente' e a retorna
        const entity = new WalletEntity()
        entity.id = wallet.id
        entity.playerId = wallet.playerId
        entity.currency = wallet.currency
        entity.balance = wallet.balance.toString()
        entity.version = wallet.version
        entity.createdAt = wallet.createdAt
        entity.updatedAt = wallet.updatedAt
        
        return entity
    }

    static toDomain(entity: WalletEntity): Wallet {
        // Reconstrói o balance da carteiro usando Money
        const balance = Money.from({
            amount: entity.balance,
            currency: entity.currency
        })

        // retorna em Wallet para o formato
        return Wallet.rehydrate({
            id: entity.id,
            playerId: entity.playerId,
            currency: entity.currency,
            balance,
            version: entity.version,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt
        })
    }
}
